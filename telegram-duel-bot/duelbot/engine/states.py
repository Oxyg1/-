"""Автомат статусов дуэли."""
from __future__ import annotations

from enum import StrEnum


class Status(StrEnum):
    CHALLENGED = "challenged"  # вызов отправлен, ждём «Принять»
    STAKING = "staking"        # приняли, ждём ставки (только для режима со ставками)
    LOBBY = "lobby"            # виджеты отправлены, ждём готовности и замеряем пинг
    ROUND = "round"            # идёт раунд (приготовься → сигнал → нажатия)
    FINISHED = "finished"
    CANCELLED = "cancelled"    # отказ, таймаут, сбой


TERMINAL = frozenset({Status.FINISHED, Status.CANCELLED})
ACTIVE = frozenset({Status.CHALLENGED, Status.STAKING, Status.LOBBY, Status.ROUND})

ALLOWED: dict[Status, frozenset[Status]] = {
    Status.CHALLENGED: frozenset({Status.STAKING, Status.LOBBY, Status.CANCELLED}),
    Status.STAKING: frozenset({Status.LOBBY, Status.CANCELLED}),
    Status.LOBBY: frozenset({Status.ROUND, Status.CANCELLED}),
    Status.ROUND: frozenset({Status.FINISHED, Status.CANCELLED}),
    Status.FINISHED: frozenset(),
    Status.CANCELLED: frozenset(),
}


class InvalidTransition(ValueError):
    pass


def can_transition(src: Status, dst: Status) -> bool:
    return dst in ALLOWED[src]


def require_transition(src: Status, dst: Status) -> None:
    if not can_transition(src, dst):
        raise InvalidTransition(f"{src} -> {dst}")
