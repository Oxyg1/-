"""Типы игрового движка. Ничего про Telegram, сеть и БД."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class Outcome(StrEnum):
    WIN = "win"
    DRAW = "draw"
    CANCELLED = "cancelled"


class Reason(StrEnum):
    FASTER = "faster"                      # оба нажали, победитель быстрее
    FALSE_START = "false_start"            # проигравший нажал до сигнала
    TOO_FAST = "too_fast"                  # реакция (с поправкой на пинг) быстрее человеческой
    OPPONENT_TIMEOUT = "opponent_timeout"  # соперник не нажал, политика «win»
    TIE = "tie"                            # разница в пределах погрешности
    BOTH_FALSE_START = "both_false_start"  # оба нарушили
    NO_RESPONSE = "no_response"            # никто не нажал
    ONE_SIDED_TIMEOUT = "one_sided_timeout"  # нажал один, политика «cancel»
    TIMEOUT = "timeout"                    # таймаут до начала раунда (вызов, ставка, готовность)
    DECLINED = "declined"
    ABORTED = "aborted"                    # сбой/перезапуск бота


FOUL_REASONS = frozenset({Reason.FALSE_START, Reason.TOO_FAST, Reason.BOTH_FALSE_START})


@dataclass(frozen=True)
class JudgeConfig:
    min_human_ms: float = 80.0        # быстрее (после вычета пинга) — нарушение
    tie_ms: float = 20.0              # разница не больше — ничья
    response_timeout_s: float = 5.0   # сколько ждём нажатие после сигнала
    false_start_grace_s: float = 0.3  # ждём, не нарушит ли и второй
    one_sided_policy: str = "cancel"  # "cancel" | "win"


@dataclass(frozen=True)
class PlayerState:
    """Состояние игрока в раунде. Все времена — секунды по монотонным часам сервера."""
    user_id: int
    rtt_s: float = 0.0
    t_signal: float | None = None   # момент, когда сервер отправил сигнал именно этому игроку
    press_at: float | None = None   # момент получения нажатия сервером
    early: bool = False             # нажатие пришло до сигнала


@dataclass(frozen=True)
class RoundResult:
    outcome: Outcome
    reason: Reason
    winner_id: int | None = None
    loser_id: int | None = None
    reaction_ms: dict[int, float | None] = field(default_factory=dict)


@dataclass(frozen=True)
class Evaluation:
    result: RoundResult | None
    wake_at: float | None = None  # когда вызвать evaluate снова, если нового события не будет
