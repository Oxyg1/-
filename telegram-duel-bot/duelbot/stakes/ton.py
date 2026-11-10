"""Ставки в TON: «проигравший платит победителю» напрямую, без хранения ключей ботом.

Почему так: Bot API не даёт боту ни приёма TON, ни выплат; подписывать переводы сам бот не будет
(хранение ключей = ответственность за чужие деньги). Поэтому:
  1. Перед раундом оба игрока подтверждают ставку в виджете (`request('join', {wallet:true})`):
     бот получает TonWalletCard (адрес и баланс) и проверяет, что на кошельке хватит на ставку + комиссию.
  2. После победы создаётся долг: проигравший платит победителю на адрес из его карточки,
     в комментарии — `duel:<id>`. Виджет проигравшего открывает окно кошелька
     (`wallet.sendTransaction`), бот отвечает готовой транзакцией.
  3. Бот независимо проверяет оплату по входящим транзакциям адреса победителя (toncenter v3).
     Статус по msg_hash не используется: документация TON не рекомендует его для платежей.
Ограничение: это не эскроу. Проигравший может не заплатить; тогда долг переходит в «unpaid»,
игрок блокируется для новых TON-ставок, пока не оплатит.
"""
from __future__ import annotations

import logging
import time
from decimal import Decimal

from ..config import Settings
from ..engine.models import Outcome, RoundResult
from ..engine.settlement import ton_claim
from ..storage.db import Database, Duel, Player, TonClaim
from .base import StakeKind, StakeSpec
from .ton_client import ToncenterClient
from .ton_utils import (
    NANO, build_transaction, format_ton, match_payment, parse_address, same_address,
)

log = logging.getLogger(__name__)


class TonStakeProvider:
    kind = StakeKind.TON

    def __init__(self, db: Database, settings: Settings, client: ToncenterClient):
        self.db, self.s, self.client = db, settings, client

    # ---- проверка ставки ----
    def validate(self, spec: StakeSpec, challenger: Player, target: Player) -> str | None:
        if not self.s.enable_ton_stakes:
            return "Ставки в TON выключены."
        lo, hi = int(Decimal(str(self.s.ton_min)) * NANO), int(Decimal(str(self.s.ton_max)) * NANO)
        if not (lo <= spec.amount <= hi):
            return f"Ставка в TON: от {self.s.ton_min} до {self.s.ton_max}."
        for p in (challenger, target):
            if p.ton_blocked:
                return f"{p.display} не оплатил прошлый проигрыш в TON и не может играть на TON."
        return None

    async def begin(self, duel: Duel, only: int | None = None) -> None:
        return None  # подтверждение ставки идёт из виджета (on_join)

    # ---- шаг 1: подтверждение ставки ----
    async def on_join(self, duel: Duel, user_id: int, wallet_card: dict | None) -> str | None:
        """Возвращает код ошибки для виджета или None, если ставка принята."""
        if duel.status.value != "staking":
            return "late"
        if not wallet_card or not wallet_card.get("address"):
            return "nw"
        try:
            parse_address(wallet_card["address"])
            balance = int(wallet_card.get("amount") or 0)
        except (ValueError, TypeError):
            return "nw"
        need = duel.stake_amount + int(Decimal(str(self.s.ton_fee_reserve)) * NANO)
        if balance < need:
            return "low"
        await self.db.set_dp(duel.id, user_id, wallet_address=wallet_card["address"],
                             wallet_balance=str(balance), funded=True)
        return None

    # ---- шаг 2: оплата проигравшим ----
    async def on_pay_request(self, duel: Duel, user_id: int, wallet_card: dict | None) -> dict:
        """Транзакция для wallet.sendTransaction или {"e": код}."""
        claim = await self.db.get_claim(duel.id)
        if claim is None or claim.payer_id != user_id:
            return {"e": "bad"}
        if claim.status == "confirmed":
            return {"e": "paid"}
        if wallet_card and wallet_card.get("address") and not claim.payer_address:
            await self.db.update_claim(duel.id, payer_address=wallet_card["address"])
        return build_transaction(claim.payee_address, claim.amount_nano, claim.comment, time.time(),
                                 self.s.ton_network)

    async def on_sent_transaction(self, duel: Duel, user_id: int, wallet: dict, msg_hash: str) -> bool:
        """Фиксируем адрес реального отправителя; сам платёж подтвердит verify_claims()."""
        claim = await self.db.get_claim(duel.id)
        if claim is None or claim.payer_id != user_id or claim.status not in ("pending", "tx_reported", "unpaid"):
            return False
        await self.db.update_claim(duel.id, reported_sender=wallet.get("address"),
                                   reported_msg_hash=msg_hash,
                                   status="tx_reported" if claim.status != "unpaid" else "unpaid")
        return True

    # ---- расчёт ----
    async def settle(self, duel: Duel, result: RoundResult) -> str:
        spec = f"{format_ton(duel.stake_amount)} TON"
        c = ton_claim(result)
        if c is None:
            return f"💎 Ставка {spec}: платить никому не нужно."
        payee = await self.db.get_dp(duel.id, c.payee_id)
        payer = await self.db.get_dp(duel.id, c.payer_id)
        if payee is None or not payee.wallet_address:
            return f"💎 Ставка {spec}: у победителя нет адреса кошелька, платёж не создан."
        await self.db.create_claim(
            duel.id, c.payer_id, c.payee_id, payee.wallet_address, payer.wallet_address if payer else None,
            duel.stake_amount, f"duel:{duel.id}", self.s.ton_claim_ttl)
        return f"💎 Ставка {spec}: проигравший должен заплатить победителю в течение {self.s.ton_claim_ttl // 60} мин."

    async def cancel(self, duel: Duel) -> str:
        return ""  # TON в эскроу не удерживается, возвращать нечего

    # ---- фоновая проверка ----
    async def verify_claims(self) -> list[tuple[TonClaim, str]]:
        """Проверяет открытые долги. Возвращает события [(claim, 'confirmed'|'unpaid')] для уведомлений."""
        events: list[tuple[TonClaim, str]] = []
        now = time.time()
        for claim in await self.db.claims_to_verify(now):
            try:
                txs = await self.client.account_transactions(claim.payee_address, int(claim.created_at) - 120)
            except Exception:  # noqa: BLE001
                log.exception("toncenter request failed")
                continue
            senders = {a for a in (claim.reported_sender, claim.payer_address) if a}
            m = match_payment(payee_address=claim.payee_address, senders=senders,
                              amount_nano=claim.amount_nano, comment=claim.comment, transactions=txs)
            if m is not None:
                await self.db.update_claim(claim.duel_id, status="confirmed", tx_hash=m.tx_hash,
                                           confirmed_at=now)
                if await self.db.open_claim_for_payer(claim.payer_id) is None:
                    await self.db.set_ton_blocked(claim.payer_id, False)
                claim.status = "confirmed"
                events.append((claim, "confirmed"))
            elif claim.status in ("pending", "tx_reported") and now > claim.deadline_at:
                await self.db.update_claim(claim.duel_id, status="unpaid")
                await self.db.set_ton_blocked(claim.payer_id, True)
                claim.status = "unpaid"
                events.append((claim, "unpaid"))
        return events
