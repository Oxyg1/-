"""Статистика игроков, рейтинг Эло и таблица лидеров. Чистые функции."""
from __future__ import annotations

from dataclasses import dataclass, replace

from .models import FOUL_REASONS, Outcome, Reason, RoundResult

DEFAULT_RATING = 1000
DEFAULT_K = 32
# реакции, которые честно отражают скорость игрока: идут в «лучшее» и «среднее» время
CLEAN_REASONS = frozenset({Reason.FASTER, Reason.TIE})


@dataclass(frozen=True)
class Stats:
    user_id: int
    wins: int = 0
    losses: int = 0
    draws: int = 0
    false_starts: int = 0
    best_ms: float | None = None
    rating: int = DEFAULT_RATING
    streak: int = 0           # текущая серия побед подряд
    best_streak: int = 0
    react_sum: float = 0.0    # сумма «чистых» реакций, для среднего
    react_n: int = 0

    @property
    def games(self) -> int:
        return self.wins + self.losses + self.draws

    @property
    def avg_ms(self) -> float | None:
        return self.react_sum / self.react_n if self.react_n else None

    @property
    def win_rate(self) -> float | None:
        return self.wins / self.games if self.games else None


def expected_score(ra: float, rb: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))


def elo_delta(ra: int, rb: int, score_a: float, k: int = DEFAULT_K) -> int:
    """Изменение рейтинга игрока A. У B — то же число с обратным знаком (сумма сохраняется)."""
    return round(k * (score_a - expected_score(ra, rb)))


def score_for(result: RoundResult, uid: int) -> float | None:
    """1 — победа, 0 — поражение, 0.5 — ничья, None — раунд не считается."""
    if result.outcome is Outcome.CANCELLED:
        return None
    if result.outcome is Outcome.DRAW:
        return 0.5
    if result.winner_id == uid:
        return 1.0
    if result.loser_id == uid:
        return 0.0
    return None


def rating_deltas(result: RoundResult, a: Stats, b: Stats, k: int = DEFAULT_K) -> dict[int, int]:
    sa = score_for(result, a.user_id)
    if sa is None:
        return {a.user_id: 0, b.user_id: 0}
    d = elo_delta(a.rating, b.rating, sa, k)
    return {a.user_id: d, b.user_id: -d}


def apply_result(stats: Stats, result: RoundResult, rating_delta: int = 0) -> Stats:
    """Новая статистика игрока `stats.user_id` после раунда. Отменённые раунды ничего не меняют."""
    uid = stats.user_id
    if result.outcome is Outcome.CANCELLED:
        return stats
    own_ms = result.reaction_ms.get(uid)
    clean = result.reason in CLEAN_REASONS and own_ms is not None and own_ms > 0
    s = replace(stats, rating=stats.rating + rating_delta)
    if clean:
        s = replace(s, react_sum=s.react_sum + own_ms, react_n=s.react_n + 1)  # type: ignore[operator]
    if result.outcome is Outcome.DRAW:
        fs = 1 if result.reason is Reason.BOTH_FALSE_START else 0
        best = _best(s.best_ms, own_ms) if clean else s.best_ms
        return replace(s, draws=s.draws + 1, false_starts=s.false_starts + fs, best_ms=best)
    if result.winner_id == uid:
        streak = s.streak + 1
        best = _best(s.best_ms, own_ms) if clean else s.best_ms
        return replace(s, wins=s.wins + 1, best_ms=best, streak=streak, best_streak=max(s.best_streak, streak))
    if result.loser_id == uid:
        fs = 1 if result.reason in FOUL_REASONS else 0
        best = _best(s.best_ms, own_ms) if clean else s.best_ms
        return replace(s, losses=s.losses + 1, false_starts=s.false_starts + fs, best_ms=best, streak=0)
    return stats


def _best(current: float | None, new: float | None) -> float | None:
    if new is None or new <= 0:
        return current
    return new if current is None else min(current, new)


def rank_key(s: Stats):
    """Рейтинг → больше побед → меньше поражений → лучшее время → стабильный порядок по id."""
    return (-s.rating, -s.wins, s.losses, s.best_ms if s.best_ms is not None else float("inf"), s.user_id)


def leaderboard_sort(stats: list[Stats], limit: int | None = None) -> list[Stats]:
    ranked = sorted((s for s in stats if s.games > 0), key=rank_key)
    return ranked[:limit] if limit else ranked
