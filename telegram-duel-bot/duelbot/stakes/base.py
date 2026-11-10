"""Интерфейс ставок. Режим по умолчанию — «на интерес» (NoStakeProvider)."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from ..engine.models import RoundResult
from ..storage.db import Duel, Player


class StakeKind(StrEnum):
    NONE = "none"
    STARS = "stars"
    TON = "ton"


@dataclass(frozen=True)
class StakeSpec:
    kind: StakeKind
    amount: int          # Stars: штуки; TON: нанотоны
    label: str = ""      # человекочитаемо: «50», «0.5»

    @property
    def is_none(self) -> bool:
        return self.kind is StakeKind.NONE


NO_STAKE = StakeSpec(StakeKind.NONE, 0)


class StakeError(Exception):
    """Ошибка ставки, текст можно показать пользователю."""


class StakeProvider(Protocol):
    kind: StakeKind

    def validate(self, spec: StakeSpec, challenger: Player, target: Player) -> str | None:
        """Текст ошибки, если такую ставку создать нельзя; иначе None."""

    async def begin(self, duel: Duel, only: int | None = None) -> None:
        """Вызывается после принятия вызова: выставить счета / предложить подтвердить ставку.
        only — повторить только для одного игрока (например, после его /start)."""

    async def settle(self, duel: Duel, result: RoundResult) -> str:
        """Раунд завершён (победа/ничья). Вернуть короткий итог по ставке для чата."""

    async def cancel(self, duel: Duel) -> str:
        """Дуэль отменена до или во время раунда: вернуть то, что было внесено."""


class NoStakeProvider:
    kind = StakeKind.NONE

    def validate(self, spec, challenger, target):
        return None

    async def begin(self, duel, only=None):
        return None

    async def settle(self, duel, result):
        return ""

    async def cancel(self, duel):
        return ""
