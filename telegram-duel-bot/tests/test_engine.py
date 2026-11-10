import random

import pytest

from duelbot.engine.judge import evaluate
from duelbot.engine.models import JudgeConfig, Outcome, PlayerState, Reason, RoundResult
from duelbot.engine.rating import Stats, apply_result, elo_delta, leaderboard_sort, rating_deltas
from duelbot.engine.settlement import StarsAction, stars_plan, ton_claim
from duelbot.engine.states import InvalidTransition, Status, can_transition, require_transition
from duelbot.engine.timing import estimate_rtt, random_delay, reaction_ms

CFG = JudgeConfig(min_human_ms=80, tie_ms=20, response_timeout_s=5, false_start_grace_s=0.3)
T0 = 1000.0


def P(uid, press_ms=None, rtt_ms=0.0, early=False, signalled=True):
    """Игрок: сигнал в T0, нажатие через press_ms мс после сигнала (по времени прихода на сервер)."""
    return PlayerState(
        user_id=uid,
        rtt_s=rtt_ms / 1000,
        t_signal=T0 if signalled else None,
        press_at=None if press_ms is None else T0 + press_ms / 1000,
        early=early,
    )


# ---------- задержка и пинг ----------
def test_random_delay_within_bounds_and_deterministic():
    r1, r2 = random.Random(1), random.Random(1)
    xs = [random_delay(r1) for _ in range(200)]
    assert all(2.0 <= x <= 6.0 for x in xs)
    assert xs == [random_delay(r2) for _ in range(200)]
    assert len({round(x, 3) for x in xs}) > 100  # не константа


def test_random_delay_bad_bounds():
    with pytest.raises(ValueError):
        random_delay(random.Random(), 6, 2)


def test_estimate_rtt_median_default_and_cap():
    assert estimate_rtt([0.10, 0.30, 0.20], default=0.15, max_rtt=0.5) == pytest.approx(0.20)
    assert estimate_rtt([], default=0.15, max_rtt=0.5) == 0.15
    assert estimate_rtt([5.0], default=0.15, max_rtt=0.5) == 0.5      # нельзя раздуть пинг
    assert estimate_rtt([-1.0], default=0.15, max_rtt=0.5) == 0.15    # мусор игнорируем


def test_reaction_subtracts_rtt():
    assert reaction_ms(P(1, press_ms=400, rtt_ms=150)) == pytest.approx(250)
    assert reaction_ms(P(1)) is None


# ---------- фальстарт ----------
def test_false_start_loses_after_grace():
    a = P(1, press_ms=-500, early=True, signalled=False)
    b = P(2, signalled=False)
    # внутри окна ожидания — решения ещё нет
    ev = evaluate(a, b, CFG, now=T0 - 0.5 + 0.1)
    assert ev.result is None and ev.wake_at == pytest.approx(T0 - 0.5 + 0.3)
    ev = evaluate(a, b, CFG, now=T0 - 0.5 + 0.31)
    assert ev.result.outcome is Outcome.WIN
    assert (ev.result.winner_id, ev.result.loser_id) == (2, 1)
    assert ev.result.reason is Reason.FALSE_START


def test_both_false_start_is_draw():
    a = P(1, press_ms=-300, early=True, signalled=False)
    b = P(2, press_ms=-200, early=True, signalled=False)
    r = evaluate(a, b, CFG, now=T0).result
    assert r.outcome is Outcome.DRAW and r.reason is Reason.BOTH_FALSE_START


def test_press_before_signal_detected_even_without_flag():
    a = PlayerState(1, 0.0, t_signal=T0, press_at=T0 - 0.1)
    r = evaluate(a, P(2), CFG, now=T0 + 1).result
    assert r.reason is Reason.FALSE_START and r.loser_id == 1


def test_too_fast_after_rtt_correction_is_foul():
    # пришло через 200 мс, но RTT 150 → реакция 50 мс < 80 мс: нажал, не дождавшись сигнала
    a = P(1, press_ms=200, rtt_ms=150)
    b = P(2, press_ms=500, rtt_ms=50)
    r = evaluate(a, b, CFG, now=T0 + 1).result
    assert r.outcome is Outcome.WIN and r.winner_id == 2 and r.reason is Reason.TOO_FAST


def test_boundary_min_human_is_valid():
    a = P(1, press_ms=180, rtt_ms=100)  # ровно 80 мс — не нарушение
    b = P(2, press_ms=400, rtt_ms=0)
    r = evaluate(a, b, CFG, now=T0 + 1).result
    assert r.winner_id == 1 and r.reason is Reason.FASTER


# ---------- победитель и ничья ----------
def test_faster_wins_with_rtt_compensation():
    # b пришёл раньше «на проводе», но у a пинг выше: после поправки a быстрее
    a = P(1, press_ms=450, rtt_ms=250)  # 200 мс
    b = P(2, press_ms=330, rtt_ms=30)   # 300 мс
    r = evaluate(a, b, CFG, now=T0 + 1).result
    assert r.winner_id == 1 and r.reason is Reason.FASTER
    assert r.reaction_ms[1] == pytest.approx(200) and r.reaction_ms[2] == pytest.approx(300)


@pytest.mark.parametrize("diff,tie", [(0, True), (20, True), (21, False)])
def test_tie_within_tolerance(diff, tie):
    a = P(1, press_ms=300)
    b = P(2, press_ms=300 + diff)
    r = evaluate(a, b, CFG, now=T0 + 1).result
    assert (r.outcome is Outcome.DRAW) is tie
    if tie:
        assert r.reason is Reason.TIE and r.winner_id is None
    else:
        assert r.winner_id == 1


# ---------- таймауты ----------
def test_waits_for_silent_player_until_timeout_then_cancels():
    a = P(1, press_ms=300)
    b = P(2)
    ev = evaluate(a, b, CFG, now=T0 + 1)
    assert ev.result is None and ev.wake_at == pytest.approx(T0 + 5)
    r = evaluate(a, b, CFG, now=T0 + 5.01).result
    assert r.outcome is Outcome.CANCELLED and r.reason is Reason.ONE_SIDED_TIMEOUT


def test_silent_player_still_can_press_before_timeout():
    a = P(1, press_ms=300)
    b = P(2, press_ms=2500)
    r = evaluate(a, b, CFG, now=T0 + 3).result
    assert r.winner_id == 1


def test_one_sided_policy_win():
    cfg = JudgeConfig(one_sided_policy="win")
    r = evaluate(P(1, press_ms=300), P(2), cfg, now=T0 + 6).result
    assert r.outcome is Outcome.WIN and r.winner_id == 1 and r.reason is Reason.OPPONENT_TIMEOUT


def test_nobody_pressed_cancels():
    assert evaluate(P(1), P(2), CFG, now=T0 + 1).result is None
    r = evaluate(P(1), P(2), CFG, now=T0 + 5.01).result
    assert r.outcome is Outcome.CANCELLED and r.reason is Reason.NO_RESPONSE


def test_no_decision_before_signal():
    ev = evaluate(P(1, signalled=False), P(2, signalled=False), CFG, now=T0)
    assert ev.result is None and ev.wake_at is None


# ---------- рейтинг ----------
def _win_result(w, l, wms=210.0, lms=260.0, reason=Reason.FASTER):
    return RoundResult(Outcome.WIN, reason, w, l, {w: wms, l: lms})


def test_apply_result_win_loss_best_time():
    s1, s2 = Stats(1), Stats(2)
    s1 = apply_result(s1, _win_result(1, 2))
    s2 = apply_result(s2, _win_result(1, 2))
    assert (s1.wins, s1.best_ms) == (1, 210.0)
    assert (s2.losses, s2.false_starts) == (1, 0)
    s1 = apply_result(s1, _win_result(1, 2, wms=190.0))
    s1 = apply_result(s1, _win_result(1, 2, wms=300.0))
    assert s1.wins == 3 and s1.best_ms == 190.0


def test_false_start_counted_for_loser_only():
    r = RoundResult(Outcome.WIN, Reason.FALSE_START, 2, 1, {1: None, 2: None})
    assert apply_result(Stats(1), r).false_starts == 1
    assert apply_result(Stats(2), r).false_starts == 0
    assert apply_result(Stats(2), r).wins == 1


def test_draw_and_cancel():
    tie = RoundResult(Outcome.DRAW, Reason.TIE, None, None, {1: 200.0, 2: 205.0})
    s = apply_result(Stats(1), tie)
    assert (s.draws, s.wins, s.losses, s.best_ms) == (1, 0, 0, 200.0)
    bfs = RoundResult(Outcome.DRAW, Reason.BOTH_FALSE_START, None, None, {})
    assert apply_result(Stats(1), bfs).false_starts == 1
    cancelled = RoundResult(Outcome.CANCELLED, Reason.NO_RESPONSE)
    assert apply_result(Stats(1, wins=3), cancelled) == Stats(1, wins=3)


def test_leaderboard_sort_and_tiebreaks():
    rows = [
        Stats(1, wins=5, losses=2, best_ms=250),
        Stats(2, wins=5, losses=1, best_ms=300),   # меньше поражений
        Stats(3, wins=5, losses=1, best_ms=210),   # то же, но быстрее
        Stats(4, wins=7, losses=9),                # больше побед при равном рейтинге
        Stats(5, wins=0, losses=3, rating=1100),   # рейтинг решает первым
        Stats(6, wins=5, losses=1, best_ms=210),   # полное равенство → по id
        Stats(7),                                  # не играл — не попадает
    ]
    assert [s.user_id for s in leaderboard_sort(rows)] == [5, 4, 3, 6, 2, 1]
    assert len(leaderboard_sort(rows, limit=2)) == 2


def test_leaderboard_top10_limit():
    rows = [Stats(i, wins=1, rating=1000 + i) for i in range(1, 30)]
    top = leaderboard_sort(rows, limit=10)
    assert [s.user_id for s in top] == list(range(29, 19, -1))


def test_elo_is_zero_sum_and_favours_upsets():
    assert elo_delta(1000, 1000, 1.0) == 16
    assert elo_delta(1000, 1000, 0.5) == 0
    # аутсайдер, обыгравший фаворита, получает больше, чем фаворит за победу над аутсайдером
    assert elo_delta(900, 1200, 1.0) > elo_delta(1200, 900, 1.0) > 0
    win = _win_result(1, 2)
    d = rating_deltas(win, Stats(1), Stats(2))
    assert d == {1: 16, 2: -16}
    assert rating_deltas(RoundResult(Outcome.CANCELLED, Reason.TIMEOUT), Stats(1), Stats(2)) == {1: 0, 2: 0}


def test_streaks_and_average_reaction():
    s = Stats(1)
    for ms in (200.0, 240.0, 220.0):
        s = apply_result(s, _win_result(1, 2, wms=ms), 10)
    assert (s.streak, s.best_streak, s.rating) == (3, 3, 1030)
    assert s.avg_ms == 220.0 and s.best_ms == 200.0
    s = apply_result(s, _win_result(2, 1, wms=150.0, lms=260.0), -10)
    assert (s.streak, s.best_streak) == (0, 3)
    assert s.react_n == 4                       # честное поражение тоже даёт замер реакции
    # фальстарт и «слишком быстро» в среднее не идут
    s2 = apply_result(Stats(1), RoundResult(Outcome.WIN, Reason.TOO_FAST, 2, 1, {1: 40.0, 2: 200.0}))
    assert s2.react_n == 0 and s2.best_ms is None and s2.false_starts == 1


# ---------- автомат ----------
def test_state_machine():
    assert can_transition(Status.CHALLENGED, Status.STAKING)
    assert can_transition(Status.ROUND, Status.FINISHED)
    assert not can_transition(Status.FINISHED, Status.CANCELLED)
    assert not can_transition(Status.CHALLENGED, Status.ROUND)
    with pytest.raises(InvalidTransition):
        require_transition(Status.LOBBY, Status.FINISHED)


# ---------- ставки ----------
def test_stars_plan():
    win = _win_result(1, 2)
    assert stars_plan(win, (1, 2)) == {1: StarsAction.REFUND, 2: StarsAction.RETAIN}
    draw = RoundResult(Outcome.DRAW, Reason.TIE)
    assert stars_plan(draw, (1, 2)) == {1: StarsAction.REFUND, 2: StarsAction.REFUND}
    cancel = RoundResult(Outcome.CANCELLED, Reason.TIMEOUT)
    assert set(stars_plan(cancel, (1, 2)).values()) == {StarsAction.REFUND}


def test_ton_claim_only_on_win():
    c = ton_claim(_win_result(1, 2))
    assert (c.payer_id, c.payee_id) == (2, 1)
    assert ton_claim(RoundResult(Outcome.DRAW, Reason.TIE)) is None
    assert ton_claim(RoundResult(Outcome.CANCELLED, Reason.TIMEOUT)) is None
