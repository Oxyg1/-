"""Чистые функции для TON: суммы, адреса, комментарий-BoC, транзакция для кошелька, сверка платежа.

Источники:
  * Telegram Widgets: формат sendTransaction {valid_until, network?, messages:[{address, amount, payload?}]},
    адрес — user-friendly, сумма — нанотоны десятичной строкой;
  * TON Connect docs: network '-239' mainnet / '-3' testnet, payload — base64 BoC (текстовый комментарий);
  * toncenter API v3 GET /transactions: transactions[].in_msg{source,destination,value,bounced,
    message_content{body,decoded}}, description.aborted, emulated, mc_block_seqno, hash.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote

from pytoniq_core import Address, Cell, begin_cell

NANO = 10**9


def to_nano(value: str | Decimal) -> int:
    try:
        d = Decimal(str(value).replace(",", "."))
    except InvalidOperation as e:
        raise ValueError("bad amount") from e
    nano = d * NANO
    if d <= 0 or nano != nano.to_integral_value():
        raise ValueError("amount must be positive and have at most 9 decimals")
    return int(nano)


def format_ton(nano: int) -> str:
    s = f"{Decimal(nano) / NANO:f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def parse_address(text: str) -> Address:
    """Принимает raw (`0:abc…`) и user-friendly адреса. ValueError при мусоре."""
    try:
        return Address(text)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"bad TON address: {text!r}") from e


def friendly(text: str, bounceable: bool = False) -> str:
    """User-friendly адрес для sendTransaction. Для кошельков берём non-bounceable."""
    return parse_address(text).to_str(is_user_friendly=True, is_bounceable=bounceable, is_url_safe=True)


def same_address(a: str, b: str) -> bool:
    try:
        x, y = parse_address(a), parse_address(b)
    except ValueError:
        return False
    return x.wc == y.wc and x.hash_part == y.hash_part


def comment_boc_b64(text: str) -> str:
    """Текстовый комментарий TON: ячейка op=0 (32 бита) + строка."""
    cell = begin_cell().store_uint(0, 32).store_snake_string(text).end_cell()
    return base64.b64encode(cell.to_boc()).decode()


def decode_comment(body_b64: str | None) -> str | None:
    if not body_b64:
        return None
    try:
        cs = Cell.one_from_boc(base64.b64decode(body_b64)).begin_parse()
        if cs.remaining_bits < 32 or cs.load_uint(32) != 0:
            return None
        return cs.load_snake_string()
    except (binascii.Error, ValueError, Exception):  # noqa: BLE001
        return None


def fee_split(stake_nano: int, percent: float) -> tuple[int, int]:
    """(победителю, комиссия). Комиссия округляется вниз до наноединицы."""
    fee = int(Decimal(stake_nano) * Decimal(str(percent)) / 100) if percent > 0 else 0
    return stake_nano - fee, fee


def build_transaction(payee_address: str, amount_nano: int, comment: str, now: float, network: str,
                      ttl: int = 600, fee_address: str | None = None, fee_nano: int = 0) -> dict[str, Any]:
    """Запрос для TelegramWidget.wallet.sendTransaction. Поле `from` не задаём: платит кошелёк
    устройства, он может отличаться от карточки профиля. Комиссия — второе сообщение той же транзакции:
    кошелёк покажет обе суммы и подпишет их одним подтверждением."""
    payload = comment_boc_b64(comment)
    messages = [{"address": friendly(payee_address), "amount": str(amount_nano), "payload": payload}]
    if fee_address and fee_nano > 0:
        messages.append({"address": friendly(fee_address), "amount": str(fee_nano), "payload": payload})
    return {"valid_until": int(now) + ttl, "network": network, "messages": messages}


def transfer_link(address: str, amount_nano: int, comment: str) -> str:
    """Ссылка на перевод, которую открывают TON-кошельки (формат ton-transfer, через Tonkeeper)."""
    return (f"https://app.tonkeeper.com/transfer/{friendly(address)}"
            f"?amount={amount_nano}&text={quote(comment, safe='')}")


@dataclass(frozen=True)
class PaymentMatch:
    tx_hash: str
    value_nano: int
    source: str


def match_payment(*, payee_address: str, senders: set[str] | None, amount_nano: int, comment: str,
                  transactions: list[dict[str, Any]]) -> PaymentMatch | None:
    """Ищет среди транзакций получателя входящий перевод, подходящий под долг.

    Условия (TON-документация: проверять по входящим транзакциям адреса, не по msg_hash):
      * emulated=false (в блокчейне), description.aborted=false, mc_block_seqno задан (финальность);
      * in_msg: не bounced, destination == получатель, source ∈ известные кошельки плательщика
        (senders=None — от кого угодно: в режиме группы кошелёк плательщика заранее неизвестен,
        а уникальный комментарий duel:<id> и сумма однозначно связывают платёж с долгом);
      * value ≥ суммы долга; комментарий в точности равен ожидаемому.
    """
    for tx in transactions:
        msg = tx.get("in_msg") or {}
        desc = tx.get("description") or {}
        if tx.get("emulated") or desc.get("aborted") or msg.get("bounced"):
            continue
        if not tx.get("mc_block_seqno"):
            continue
        dst, src = msg.get("destination"), msg.get("source")
        if not dst or not src or not same_address(dst, payee_address):
            continue
        if senders is not None and not any(same_address(src, s) for s in senders):
            continue
        try:
            value = int(msg.get("value") or 0)
        except ValueError:
            continue
        if value < amount_nano:
            continue
        content = msg.get("message_content") or {}
        if decode_comment(content.get("body")) != comment:
            continue
        tx_hash = tx.get("hash")
        if not tx_hash:
            continue
        return PaymentMatch(tx_hash=tx_hash, value_nano=value, source=src)
    return None
