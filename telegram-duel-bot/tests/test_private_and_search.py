"""Вызов из лички по @username и поиск случайного соперника (/cfind)."""
import asyncio
import time

from tests.harness import Harness, Player
from tests.test_features import private_msg, sent_texts
from tests.test_router import cb_update, env  # noqa: F401


def mention_msg(uid, name, text, mid=40):
    m = private_msg(uid, name, text, mid)
    at = text.index("@")
    m["message"]["entities"].append({"type": "mention", "offset": at, "length": len(text) - at})
    return m


# ---------------- вызов из лички ----------------
async def test_challenge_from_private_chat(env):
    h, dp, bot, raw, session = env
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=300))
    await h.db.upsert_player(2, "bobby", "Bob", True)
    await dp.feed_raw_update(bot, mention_msg(1, "Alice", "/cduel @bobby"))
    assert "в личку" in sent_texts(session)[-1]
    duel = await h.db.get_duel(1)
    assert duel.chat_id == 0 and duel.status.value == "challenged"
    # приглашение пришло Бобу в личку обычным сообщением с кнопками
    i = max(i for i, (c, _) in enumerate(h.bot.messages) if c == 2)
    assert "вызывает тебя" in h.bot.messages[i][1]
    assert [b.callback_data for b in h.bot.markups[i].inline_keyboard[0]] == ["d:a:1", "d:d:1"]
    assert duel.ephemeral_id == 501
    # Боб принимает — приглашение правится, виджеты уходят обоим
    await dp.feed_raw_update(bot, cb_update(2, "Bobby", "d:a:1"))
    assert h.bot.edits[-1]["chat_id"] == 2 and "Вызов принят" in h.bot.edits[-1]["text"]
    await asyncio.gather(h.hi(1), h.hi(2))
    d = await h.wait_done(1)
    assert d.winner_id == 1
    assert not any(c == 0 for c, _ in h.bot.messages)            # в «группу 0» ничего не постится


async def test_private_challenge_to_someone_who_never_started_the_bot(env):
    h, dp, bot, raw, session = env
    await h.add_players(Player(1), Player(2))
    await h.db.upsert_player(2, "bobby", "Bob")
    h.bot.dm_blocked.add(2)
    await dp.feed_raw_update(bot, mention_msg(1, "Alice", "/cduel @bobby"))
    assert "ещё не запускал бота" in sent_texts(session)[-1]
    assert (await h.db.get_duel(1)).reason == "aborted"


async def test_private_decline_updates_invite(env):
    h, dp, bot, raw, session = env
    await h.add_players(Player(1), Player(2))
    await h.db.upsert_player(2, "bobby", "Bob", True)
    await dp.feed_raw_update(bot, mention_msg(1, "Alice", "/cduel @bobby"))
    await dp.feed_raw_update(bot, cb_update(2, "Bobby", "d:d:1"))
    assert h.bot.edits[-1] == {"chat_id": 2, "message_id": 501, "text": "Вы отказались от дуэли."}
    assert any(c == 1 and "отказался" in t for c, t in h.bot.messages)


# ---------------- поиск соперника ----------------
def search_msgs(h, uid):
    return [(i, t) for i, (c, t) in enumerate(h.bot.messages) if c == uid and "Ищем соперника" in t]


async def test_search_is_a_message_and_match_sends_duel_widgets(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=300))
    assert (await h.service.find(1)).startswith("🔎")
    [(i, text)] = search_msgs(h, 1)
    assert "1000" in text and h.bot.markups[i].inline_keyboard[0][0].callback_data == "f:x"
    assert h.players[1].states == []                         # поиск — не виджет
    assert "Уже ищу" in await h.service.find(1)
    await h.service.find(2)                                  # пара найдена
    assert await db.queue_all() == []
    found = [e for e in h.bot.edits if "Соперник найден" in e["text"]]
    assert {e["chat_id"] for e in found} == {1, 2} and "@p2" in next(e for e in found if e["chat_id"] == 1)["text"]
    duel = await db.get_duel(1)
    assert duel.chat_id == 0 and duel.status.value == "lobby"
    assert h.phases(1) == ["lobby"] and h.phases(2) == ["lobby"]   # дуэль — отдельным виджетом
    await asyncio.gather(h.hi(1), h.hi(2))
    d = await h.wait_done(1)
    assert d.winner_id == 1 and h.phases(1)[-1] == "win"


async def test_search_prefers_closest_rating(db, monkeypatch):
    h = Harness(db, monkeypatch)
    h.players = {i: Player(i) for i in (1, 2, 3)}
    for uid, r in ((1, 1300), (2, 1010), (3, 980)):
        await db.upsert_player(uid, f"p{uid}", f"P{uid}", True)
        await db._c.execute("UPDATE players SET rating=? WHERE user_id=?", (r, uid))
    await db._c.commit()
    # двое уже ждут (кладём напрямую, чтобы они не сыграли друг с другом)
    await db.queue_add(1, 1300, 701)
    await db.queue_add(3, 980, 703)
    await h.service.find(2)                       # 1010: ближе всего 980
    assert set((await db.active_duel_for(2)).players) == {2, 3}
    assert (await db.queue_get(1)) is not None    # 1300 ждёт дальше


async def test_cancel_search_and_timeout(db, monkeypatch):
    h = Harness(db, monkeypatch, search_ttl=60)
    await h.add_players(Player(1), Player(2))
    await h.service.find(1)
    assert await h.service.withdraw(1) == "Поиск соперника остановлен."
    assert h.bot.edits[-1]["chat_id"] == 1 and "остановлен" in h.bot.edits[-1]["text"]
    await h.service.find(2)
    await db._c.execute("UPDATE queue SET joined_at=? WHERE user_id=2", (time.time() - 120,))
    await db._c.commit()
    await h.service.sweep_once()
    assert await db.queue_all() == [] and await db.active_duel_for(2) is None
    assert "никого не нашлось" in h.bot.edits[-1]["text"]


async def test_stop_search_button(env):
    h, dp, bot, raw, session = env
    await h.add_players(Player(1), Player(2))
    await h.service.find(1)
    await dp.feed_raw_update(bot, cb_update(1, "Alice", "f:x"))
    assert await h.db.queue_get(1) is None
    answers = [m.text for m in session.calls if type(m).__name__ == "AnswerCallbackQuery"]
    assert answers[-1] == "Поиск остановлен."


async def test_accepting_a_challenge_leaves_the_queue(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    await h.service.find(2)
    duel = await h.new_duel(1, 2)
    assert await h.service.accept(duel.id, 2) is None
    assert await db.queue_get(2) is None


async def test_find_command_needs_start(env):
    h, dp, bot, raw, session = env
    await h.add_players(Player(1), Player(2))
    h.bot.dm_blocked.add(1)
    await dp.feed_raw_update(bot, private_msg(1, "Alice", "/cfind"))
    assert "Start" in sent_texts(session)[-1]
    assert await h.db.queue_get(1) is None
