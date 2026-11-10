import time

import pytest

from duelbot.engine.models import Outcome, Reason, RoundResult
from duelbot.engine.states import Status


async def _two(db):
    await db.upsert_player(1, "alice", "Alice", True)
    await db.upsert_player(2, "bob", "Bob", False)


async def test_player_upsert_username_lookup_and_can_dm(db):
    await _two(db)
    assert (await db.find_player_by_username("@ALICE")).user_id == 1
    assert (await db.get_player(2)).can_dm is False
    await db.upsert_player(2, "bobby", "Bob", None)     # None не трогает can_dm
    assert (await db.get_player(2)).can_dm is False
    await db.upsert_player(2, "bobby", "Bob", True)
    p = await db.get_player(2)
    assert p.can_dm is True and p.username == "bobby"


async def test_create_duel_and_transitions(db):
    await _two(db)
    d = await db.create_duel(-100, 1, 2, "none", 0, ttl=300)
    assert d.status is Status.CHALLENGED and len(await db.list_dp(d.id)) == 2
    assert await db.active_duel_for(1) is not None
    assert await db.transition(d.id, Status.LOBBY)
    assert not await db.transition(d.id, Status.CHALLENGED)     # назад нельзя
    assert not await db.transition(d.id, Status.FINISHED)       # LOBBY -> FINISHED нельзя


async def test_expired_duels(db):
    await _two(db)
    d = await db.create_duel(-100, 1, 2, "none", 0, ttl=-1)
    assert [x.id for x in await db.expired_duels(time.time())] == [d.id]


async def test_finish_duel_updates_stats_once_and_leaderboard(db):
    await _two(db)
    d = await db.create_duel(-100, 1, 2, "none", 0, ttl=300)
    await db.transition(d.id, Status.LOBBY)
    await db.transition(d.id, Status.ROUND)
    res = RoundResult(Outcome.WIN, Reason.FASTER, 1, 2, {1: 210.0, 2: 260.0})
    assert await db.finish_duel(d, res) is True
    assert await db.finish_duel(d, res) is False                # идемпотентность
    a, b = await db.get_player(1), await db.get_player(2)
    assert (a.wins, a.best_ms, b.losses) == (1, 210.0, 1)
    assert sorted(s.user_id for s in await db.all_stats()) == [1, 2]   # в таблице все, кто играл
    assert (a.rating, b.rating, a.streak) == (1016, 984, 1)
    fin = await db.get_duel(d.id)
    assert (fin.challenger_delta, fin.target_delta) == (16, -16)
    assert await db.rank_of(1) == 1 and await db.rank_of(2) == 2
    last = await db.last_duels()
    assert last == [{"winner": "alice", "loser": "bob", "ms": 210.0}]
    assert await db.active_duel_for(1) is None


async def test_cancelled_duel_does_not_touch_stats(db):
    await _two(db)
    d = await db.create_duel(-100, 1, 2, "none", 0, ttl=300)
    assert await db.finish_duel(d, RoundResult(Outcome.CANCELLED, Reason.TIMEOUT))
    assert (await db.get_player(1)).wins == 0
    assert (await db.get_duel(d.id)).status is Status.CANCELLED


async def test_star_payment_dedup_and_status(db):
    await _two(db)
    assert await db.add_star_payment("ch1", 1, 1, 50) is True
    assert await db.add_star_payment("ch1", 1, 1, 50) is False
    await db.set_star_payment("ch1", status="refund_failed", note="x")
    assert [p.charge_id for p in await db.failed_refunds()] == ["ch1"]


async def test_claim_lifecycle(db):
    await _two(db)
    c = await db.create_claim(7, 2, 1, "UQaddr", None, 10**9, "duel:7", ttl=60)
    assert c.status == "pending"
    await db.update_claim(7, status="confirmed", tx_hash="h")
    assert await db.open_claim_for_payer(2) is None
    with pytest.raises(ValueError):
        await db.update_claim(7, bogus=1)


async def test_kv(db):
    assert await db.kv_get("k") is None
    await db.kv_set("k", "1")
    await db.kv_set("k", "2")
    assert await db.kv_get("k") == "2"


async def test_transition_updates_fields_atomically(db):
    await _two(db)
    d = await db.create_duel(-100, 1, 2, "none", 0, ttl=300)
    assert await db.transition(d.id, Status.LOBBY, deadline_at=123.0, accepted_at=100.0)
    d2 = await db.get_duel(d.id)
    assert (d2.status, d2.deadline_at, d2.accepted_at) == (Status.LOBBY, 123.0, 100.0)
    with pytest.raises(ValueError):
        await db.transition(d.id, Status.ROUND, bogus=1)
    assert (await db.get_duel(d.id)).status is Status.LOBBY


async def test_migration_adds_columns_to_old_database(tmp_path):
    import aiosqlite

    from duelbot.storage.db import Database
    path = str(tmp_path / "old.db")
    async with aiosqlite.connect(path) as c:      # схема первой версии: без рейтинга и серий
        await c.executescript(
            "CREATE TABLE players (user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL DEFAULT '',"
            " can_dm INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,"
            " draws INTEGER NOT NULL DEFAULT 0, false_starts INTEGER NOT NULL DEFAULT 0, best_ms REAL,"
            " ton_blocked INTEGER NOT NULL DEFAULT 0, updated_at REAL NOT NULL DEFAULT 0);"
            "INSERT INTO players(user_id, username, wins) VALUES (1, 'old', 4);")
        await c.commit()
    db = await Database.connect(path)
    try:
        p = await db.get_player(1)
        assert (p.username, p.wins, p.rating, p.streak) == ("old", 4, 1000, 0)
    finally:
        await db.close()
