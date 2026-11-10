"""Разбор аргументов /duel: ставка в Stars или TON. Чистые функции."""
from __future__ import annotations

import re

from ..stakes.base import NO_STAKE, StakeKind, StakeSpec
from ..stakes.ton_utils import format_ton, to_nano

_STAKE_RE = re.compile(
    r"(?P<num>\d+(?:[.,]\d+)?)\s*(?P<unit>stars?|xtr|⭐|звёзд\w*|звезд\w*|ton|тон\w*)",
    re.IGNORECASE,
)


class StakeParseError(ValueError):
    pass


def parse_stake(text: str | None) -> StakeSpec:
    """«50 stars», «0.5 ton», «10⭐». Пусто → режим «на интерес»."""
    if not text or not text.strip():
        return NO_STAKE
    m = _STAKE_RE.search(text)
    if not m:
        return NO_STAKE
    num, unit = m.group("num"), m.group("unit").lower()
    if unit.startswith("ton") or unit.startswith("тон"):
        try:
            nano = to_nano(num)
        except ValueError as e:
            raise StakeParseError("Некорректная сумма в TON (до 9 знаков после запятой).") from e
        return StakeSpec(StakeKind.TON, nano, format_ton(nano))
    if not num.isdigit():
        raise StakeParseError("Ставка в Stars — целое число.")
    amount = int(num)
    if amount <= 0:
        raise StakeParseError("Ставка должна быть больше нуля.")
    return StakeSpec(StakeKind.STARS, amount, str(amount))


def first_username(text: str | None) -> str | None:
    """Первый @username из аргументов команды."""
    if not text:
        return None
    m = re.search(r"@([A-Za-z0-9_]{4,32})", text)
    return m.group(1) if m else None
