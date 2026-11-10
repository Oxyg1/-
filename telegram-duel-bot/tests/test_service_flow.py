import asyncio
import time

import pytest

from duelbot.engine.models import Reason
from tests.harness import Harness, Player


async def run_duel(db, monkeypatch, a: Player, b: Player, **settings):
    h = Harness(db, monkeypatch, **settings)
    await h.add_players(a, b)
    duel = await h.new_duel(a.uid, b.uid)
    assert await h.service.accept(duel.id, b.uid) is None
    await asyncio.gather(h.hi(a.uid), h.hi(b.uid))
    return h, await h.wait_done(duel.id)


async def test_faster_player_wins_and_everything_is_published(db, monkeypatch):
    h, d = await run_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=300))
    assert d.outcome == "win" and d.reason == "faster" and d.winner_id == 1 and d.loser_id == 2
    # реакция посчитана сервером и близка к настоящей (пинг вычтен)
    assert d.challenger_ms == pytest.approx(150, abs=40) and d.target_ms == pytest.approx(300, abs=40)
    # у обоих виджет прошёл lobby → wait → go → итог
    for uid, final in ((1, "win"), (2, "lose")):
        ph = h.phases(uid)
        assert ph.index("lobby") < ph.index("wait") < ph.index("go") and ph[-1] == final
    # итог в исходной группе + обновление табло
    assert any(chat == -100 and "победил" in text for chat, text in h.bot.messages)
    assert h.leaderboard.refreshes == 1
    assert (await db.get_player(1)).wins == 1 and (await db.get_player(2)).losses == 1


async def test_false_start_loses(db, monkeypatch):
    h, d = await run_duel(db, monkeypatch, Player(1, react_ms=300), Player(2, press_early_ms=10))
    assert d.winner_id == 1 and d.reason == "false_start"
    assert "go" not in h.phases(1)                       # сигнал так и не подавался
    assert h.phases(2)[-1] == "fs" and h.phases(1)[-1] == "win"
    assert (await db.get_player(2)).false_starts == 1


async def test_network_lag_is_compensated(db, monkeypatch):
    # у игрока 1 лаг 150 мс в каждую сторону, реакция одинаковая: без поправки он бы проиграл 300 мс
    a = Player(1, react_ms=200, one_way_ms=150)
    b = Player(2, react_ms=230, one_way_ms=5)
    h, d = await run_duel(db, monkeypatch, a, b, max_rtt_ms=500.0)
    assert d.outcome == "win" and d.winner_id == 1       # 200 мс против 230 мс — честная победа
    assert d.challenger_ms == pytest.approx(200, abs=45)


async def test_tie_within_tolerance(db, monkeypatch):
    h, d = await run_duel(db, monkeypatch, Player(1, react_ms=200), Player(2, react_ms=205), tie_ms=40.0)
    assert d.outcome == "draw" and d.reason == "tie" and d.winner_id is None
    assert h.phases(1)[-1] == "draw"
    assert (await db.get_player(1)).draws == 1


async def test_nobody_presses_cancels_round(db, monkeypatch):
    h, d = await run_duel(db, monkeypatch, Player(1, react_ms=None), Player(2, react_ms=None),
                          response_timeout=0.3)
    assert d.status.value == "cancelled" and d.reason == "no_response"
    assert h.phases(1)[-1] == "cancel"
    assert h.leaderboard.refreshes == 0
    assert (await db.get_player(1)).wins == 0


async def test_one_sided_timeout_cancels_by_default_and_wins_with_policy(db, monkeypatch):
    h, d = await run_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=None),
                          response_timeout=0.3)
    assert d.status.value == "cancelled" and d.reason == "one_sided_timeout"
    h2, d2 = await run_duel(db, monkeypatch, Player(3, react_ms=150), Player(4, react_ms=None),
                            response_timeout=0.3, one_sided_policy="win")
    assert d2.winner_id == 3 and d2.reason == "opponent_timeout"


async def test_unanswered_challenge_expires(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    duel = await h.service.create_duel(-100, 1, 2, "none", 0)
    await db.update_duel(duel.id, deadline_at=time.time() - 1)
    await h.service.sweep_once()
    d = await db.get_duel(duel.id)
    assert d.status.value == "cancelled" and d.reason == Reason.TIMEOUT.value
    assert await h.service.accept(duel.id, 2) == "Вызов уже недействителен."
    assert not any("победил" in t for _, t in h.bot.messages)    # в группу об истёкшем вызове не пишем


async def test_decline(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    assert not await h.service.decline(duel.id, 1)              # отказаться может только вызванный
    assert await h.service.decline(duel.id, 2)
    assert (await db.get_duel(duel.id)).reason == "declined"


async def test_lobby_timeout_when_opponent_never_opens_widget(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    await h.hi(1)                                              # второй так и не появился
    assert (await db.get_duel(duel.id)).status.value == "lobby"
    await db.update_duel(duel.id, deadline_at=time.time() - 1)
    await h.service.sweep_once()
    assert (await db.get_duel(duel.id)).status.value == "cancelled"
    assert any("отменена" in t for _, t in h.bot.messages)      # после принятия отмену видно в группе


async def test_player_must_press_start_first(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    h.raw.unreachable = {2}
    duel = await h.new_duel(1, 2)
    assert await h.service.accept(duel.id, 2) is None
    assert (await db.get_player(2)).can_dm is False
    assert any("Start" in t and chat == -100 for chat, t in h.bot.messages)   # подсказка с deep-link в группу
    h.raw.unreachable = set()
    await h.service.resume_for_player(duel.id, 2)               # игрок нажал Start по ссылке
    assert (await db.get_dp(duel.id, 2)).widget_message_id is not None


async def test_cannot_have_two_active_duels(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    d1 = await h.new_duel(1, 2)
    await h.service.accept(d1.id, 2)
    d2 = await h.new_duel(1, 2)
    assert "другой дуэли" in await h.service.accept(d2.id, 2)


async def test_press_after_round_is_ignored_and_widget_gets_final_state(db, monkeypatch):
    h, d = await run_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=300))
    assert not h.service.record_press(d.id, 2, time.monotonic())
    ans = await h.raw._query(h.players[2], "hi")                # виджет пересоздан: получает итог
    assert '"p":"lose"' in (ans or "")


async def test_bot_restart_aborts_round_and_returns_stakes(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    from duelbot.engine.states import Status
    await db.transition(duel.id, Status.ROUND)
    await h.service.recover()
    d = await db.get_duel(duel.id)
    assert d.status.value == "cancelled" and d.reason == "aborted"
