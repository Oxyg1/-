"""Ставки в Telegram Stars (XTR).

Что умеет Bot API (https://core.telegram.org/bots/api#payments):
  sendInvoice(currency="XTR", provider_token=""), answerPreCheckoutQuery, SuccessfulPayment,
  refundStarPayment(user_id, telegram_payment_charge_id), sendGift(user_id, gift_id, ...).
Метода «перевести Stars пользователю» НЕТ. Поэтому схема такая:
  * оба игрока заранее платят ставку боту;
  * победитель получает свою ставку обратно (refundStarPayment), ставка проигравшего остаётся
    на балансе бота; по желанию бот дарит победителю подарок (STARS_WINNER_GIFT_ID);
  * ничья / отмена / сбой — возврат обоим.
"""
from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.types import LabeledPrice

from ..config import Settings
from ..engine.models import RoundResult
from ..engine.settlement import StarsAction, stars_plan
from ..storage.db import Database, Duel, Player, StarPayment
from .base import StakeError, StakeKind, StakeSpec

log = logging.getLogger(__name__)


def make_payload(duel_id: int, user_id: int) -> str:
    return f"duel:{duel_id}:{user_id}"


def parse_payload(payload: str) -> tuple[int, int] | None:
    parts = payload.split(":")
    if len(parts) == 3 and parts[0] == "duel" and parts[1].isdigit() and parts[2].isdigit():
        return int(parts[1]), int(parts[2])
    return None


class StarsStakeProvider:
    kind = StakeKind.STARS

    def __init__(self, bot: Bot, db: Database, settings: Settings):
        self.bot, self.db, self.s = bot, db, settings

    def validate(self, spec: StakeSpec, challenger: Player, target: Player) -> str | None:
        if not self.s.enable_stars_stakes:
            return "Ставки в Stars выключены."
        if not (self.s.stars_min <= spec.amount <= self.s.stars_max):
            return f"Ставка в Stars: от {self.s.stars_min} до {self.s.stars_max}."
        return None

    async def begin(self, duel: Duel, only: int | None = None) -> None:
        """Отправляет каждому игроку счёт в личку."""
        for uid in duel.players:
            if only is not None and uid != only:
                continue
            try:
                await self.bot.send_invoice(
                    chat_id=uid,
                    title="Ставка в дуэли",
                    description=f"Ставка {duel.stake_amount} ⭐ в дуэли №{duel.id}. "
                                "Победитель получает ставку обратно, при ничьей и отмене возвращаем обоим.",
                    payload=make_payload(duel.id, uid),
                    currency="XTR",
                    prices=[LabeledPrice(label="Ставка", amount=duel.stake_amount)],
                    provider_token="",
                )
            except Exception as e:  # noqa: BLE001
                raise StakeError(f"Не удалось отправить счёт игроку {uid}: {e}") from e

    # ---- входящие платёжные апдейты ----
    async def check_pre_checkout(self, user_id: int, currency: str, total: int, payload: str) -> str | None:
        """None = можно принять платёж, иначе текст отказа (его покажет Telegram)."""
        parsed = parse_payload(payload)
        if parsed is None or currency != "XTR":
            return "Неизвестный счёт."
        duel_id, uid = parsed
        duel = await self.db.get_duel(duel_id)
        if duel is None or uid != user_id or user_id not in duel.players:
            return "Этот счёт не для вас."
        if duel.status.value != "staking":
            return "Дуэль уже не ждёт ставок."
        if total != duel.stake_amount:
            return "Сумма не совпадает со ставкой."
        dp = await self.db.get_dp(duel_id, user_id)
        if dp and dp.funded:
            return "Вы уже внесли ставку."
        return None

    async def on_successful_payment(self, user_id: int, total: int, payload: str, charge_id: str) -> Duel | None:
        """Фиксирует платёж. Если дуэль уже не ждёт ставок, платёж сразу возвращается."""
        parsed = parse_payload(payload)
        if parsed is None:
            log.error("successful_payment with unknown payload %r (charge %s)", payload, charge_id)
            return None
        duel_id, uid = parsed
        if not await self.db.add_star_payment(charge_id, duel_id, user_id, total):
            return None  # дубликат доставки
        duel = await self.db.get_duel(duel_id)
        if duel is None or duel.status.value != "staking" or uid != user_id:
            await self._refund_one(StarPayment(charge_id, duel_id, user_id, total, "paid", 0, None),
                                   note="late payment")
            return None
        await self.db.set_dp(duel_id, user_id, funded=True)
        return duel

    # ---- расчёт ----
    async def _refund_one(self, pay: StarPayment, note: str = "") -> bool:
        try:
            await self.bot.refund_star_payment(user_id=pay.user_id, telegram_payment_charge_id=pay.charge_id)
            await self.db.set_star_payment(pay.charge_id, status="refunded", note=note or None)
            return True
        except Exception as e:  # noqa: BLE001
            log.exception("refund failed for %s", pay.charge_id)
            await self.db.set_star_payment(pay.charge_id, status="refund_failed", note=str(e)[:200])
            return False

    async def retry_failed_refunds(self) -> int:
        n = 0
        for pay in await self.db.failed_refunds():
            if await self._refund_one(pay, note="retry"):
                n += 1
        return n

    async def settle(self, duel: Duel, result: RoundResult) -> str:
        plan = stars_plan(result, duel.players)
        pays = {p.user_id: p for p in await self.db.star_payments(duel.id) if p.status in ("paid", "refund_failed")}
        failed = 0
        for uid, action in plan.items():
            pay = pays.get(uid)
            if pay is None:
                continue
            if action is StarsAction.REFUND:
                if not await self._refund_one(pay):
                    failed += 1
            else:
                await self.db.set_star_payment(pay.charge_id, status="retained")
        text = f"⭐ Ставка {duel.stake_amount}: "
        if result.winner_id is not None:
            text += "победитель получил свою ставку назад, ставка проигравшего остаётся у бота."
            gift = await self._send_gift(result.winner_id)
            if gift:
                text += " Победителю отправлен подарок."
        else:
            text += "ставки возвращены обоим игрокам."
        if failed:
            text += f" ⚠ Не удалось вернуть {failed} платеж(а), бот повторит попытку."
        return text

    async def _send_gift(self, user_id: int) -> bool:
        gift_id = self.s.stars_winner_gift_id.strip()
        if not gift_id:
            return False
        try:
            await self.bot.send_gift(user_id=user_id, gift_id=gift_id, text="Победа в дуэли! 🤠")
            return True
        except Exception:  # noqa: BLE001
            log.exception("sendGift failed")
            return False

    async def cancel(self, duel: Duel) -> str:
        pays = [p for p in await self.db.star_payments(duel.id) if p.status in ("paid", "refund_failed")]
        if not pays:
            return ""
        failed = 0
        for pay in pays:
            if not await self._refund_one(pay, note="cancelled"):
                failed += 1
        return "⭐ Внесённые ставки возвращены." + (f" ⚠ {failed} возврат(а) не прошли, бот повторит." if failed else "")
