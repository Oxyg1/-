"""Статистика игроков и таблица лидеров. Чистые функции."""
from __future__ import annotations

from dataclasses import dataclass, replace

from .models import FOUL_REASONS, Outcome, Reason, RoundResult


@dataclass(frozen=True)
class Stats:
    user_id: int
    wins: int = 0
    losses: int = 0
    draws: int = 0
    false_starts: int = 0
    best_ms: float | None = None


def apply_result(stats: Stats, result: RoundResult) -> Stats:
    """Новая статистика игрока `stats.user_id` после раунда. Отменённые раунды ничего не меняют."""
    uid = stats.user_id
    own_ms = result.reaction_ms.get(uid)
    if result.outcome is Outcome.CANCELLED:
        return stats
    if result.outcome is Outcome.DRAW:
        fs = 1 if result.reason is Reason.BOTH_FALSE_START else 0
        best = _best(stats.best_ms, own_ms) if result.reason is Reason.TIE else stats.best_ms
        return replace(stats, draws=stats.draws + 1, false_starts=stats.false_starts + fs, best_ms=best)
    if result.winner_id == uid:
        return replace(stats, wins=stats.wins + 1, best_ms=_best(stats.best_ms, own_ms))
    if result.loser_id == uid:
        fs = 1 if result.reason in FOUL_REASONS else 0
        return replace(stats, losses=stats.losses + 1, false_starts=stats.false_starts + fs)
    return stats


def _best(current: float | None, new: float | None) -> float | None:
    if new is None or new <= 0:
        return current
    return new if current is None else min(current, new)


def rank_key(s: Stats):
    """Больше побед → меньше поражений → лучшее время → стабильный порядок по id."""
    return (-s.wins, s.losses, s.best_ms if s.best_ms is not None else float("inf"), s.user_id)


def leaderboard_sort(stats: list[Stats], limit: int | None = None) -> list[Stats]:
    ranked = sorted((s for s in stats if s.wins > 0), key=rank_key)
    return ranked[:limit] if limit else ranked
