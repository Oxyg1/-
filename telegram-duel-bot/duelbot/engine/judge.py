"""Судья раунда: чистая функция evaluate(). Вызывается после каждого события и по таймеру."""
from __future__ import annotations

from .models import (
    Evaluation,
    JudgeConfig,
    Outcome,
    PlayerState,
    Reason,
    RoundResult,
)
from .timing import reaction_ms


def _is_early(p: PlayerState) -> bool:
    if p.early:
        return True
    return p.press_at is not None and (p.t_signal is None or p.press_at < p.t_signal)


def _reactions(a: PlayerState, b: PlayerState) -> dict[int, float | None]:
    return {
        a.user_id: None if _is_early(a) else reaction_ms(a),
        b.user_id: None if _is_early(b) else reaction_ms(b),
    }


def _win(winner: PlayerState, loser: PlayerState, reason: Reason, a, b) -> RoundResult:
    return RoundResult(Outcome.WIN, reason, winner.user_id, loser.user_id, _reactions(a, b))


def evaluate(a: PlayerState, b: PlayerState, cfg: JudgeConfig, now: float) -> Evaluation:
    """Решает, закончился ли раунд.

    Возвращает Evaluation(result=None, wake_at=...), если рано; wake_at — когда проверить снова.
    """
    early = {p.user_id: _is_early(p) for p in (a, b)}
    # --- нарушения до сигнала ---
    if early[a.user_id] and early[b.user_id]:
        return Evaluation(RoundResult(Outcome.DRAW, Reason.BOTH_FALSE_START, None, None, _reactions(a, b)))
    for foul, other in ((a, b), (b, a)):
        if early[foul.user_id]:
            # ждём короткое время: вдруг второй тоже нарушил почти одновременно
            until = (foul.press_at or now) + cfg.false_start_grace_s
            if now < until:
                return Evaluation(None, until)
            return Evaluation(_win(other, foul, Reason.FALSE_START, a, b))

    # --- сигнала ещё нет ---
    if a.t_signal is None or b.t_signal is None:
        return Evaluation(None, None)

    ra, rb = reaction_ms(a), reaction_ms(b)

    # --- слишком быстро для человека (нажал раньше, чем мог увидеть сигнал) ---
    fa = ra is not None and ra < cfg.min_human_ms
    fb = rb is not None and rb < cfg.min_human_ms
    if fa and fb:
        return Evaluation(RoundResult(Outcome.DRAW, Reason.BOTH_FALSE_START, None, None, _reactions(a, b)))
    if fa:
        return Evaluation(_win(b, a, Reason.TOO_FAST, a, b))
    if fb:
        return Evaluation(_win(a, b, Reason.TOO_FAST, a, b))

    # --- оба нажали ---
    if ra is not None and rb is not None:
        if abs(ra - rb) <= cfg.tie_ms:
            return Evaluation(RoundResult(Outcome.DRAW, Reason.TIE, None, None, _reactions(a, b)))
        winner, loser = (a, b) if ra < rb else (b, a)
        return Evaluation(_win(winner, loser, Reason.FASTER, a, b))

    # --- ждём тех, кто не нажал, до таймаута ---
    deadline = max(a.t_signal, b.t_signal) + cfg.response_timeout_s
    if ra is None and rb is None:
        if now >= deadline:
            return Evaluation(RoundResult(Outcome.CANCELLED, Reason.NO_RESPONSE, None, None, _reactions(a, b)))
        return Evaluation(None, deadline)

    pressed, silent = (a, b) if ra is not None else (b, a)
    silent_deadline = silent.t_signal + cfg.response_timeout_s
    if now < silent_deadline:
        return Evaluation(None, silent_deadline)
    if cfg.one_sided_policy == "win":
        return Evaluation(_win(pressed, silent, Reason.OPPONENT_TIMEOUT, a, b))
    return Evaluation(RoundResult(Outcome.CANCELLED, Reason.ONE_SIDED_TIMEOUT, None, None, _reactions(a, b)))
