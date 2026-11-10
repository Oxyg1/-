"""Чистые функции времени: случайная задержка, пинг, поправка на задержку сети."""
from __future__ import annotations

import random
import statistics
from collections.abc import Sequence

from .models import PlayerState


def random_delay(rng: random.Random, lo: float = 2.0, hi: float = 6.0) -> float:
    """Случайная пауза до сигнала. rng передаётся снаружи: в проде SystemRandom, в тестах seeded."""
    if lo > hi:
        raise ValueError("lo > hi")
    return rng.uniform(lo, hi)


def estimate_rtt(samples: Sequence[float], default: float, max_rtt: float) -> float:
    """Медиана замеров, ограниченная сверху max_rtt.

    Сверху ограничиваем, чтобы нельзя было искусственно раздуть пинг ради «бонуса».
    Нет замеров — берём default.
    """
    valid = [s for s in samples if s >= 0]
    value = statistics.median(valid) if valid else default
    return min(max(value, 0.0), max_rtt)


def reaction_ms(p: PlayerState) -> float | None:
    """Реакция игрока в мс: (приход нажатия − сигнал) − RTT. None, если нажатия не было."""
    if p.press_at is None or p.t_signal is None:
        return None
    # округляем до микросекунд: иначе границы (80 мс, допуск ничьи) плавают из-за float
    return round((p.press_at - p.t_signal - p.rtt_s) * 1000.0, 3)
