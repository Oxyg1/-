"""Интеграция с aiogram: перехват widget_query (его нет в aiogram 3.31) и обычные хендлеры."""
import json

import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession

from duelbot.bot_api_raw import BotApiError
from duelbot.handlers.router import Ctx, DuelDispatcher, RegisterMiddleware, build_router, install_widget_handler
from tests.harness import Harness, Player


class StubSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls = []

    async def close(self): ...
    async def stream_content(self, *a, **kw): ...

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if type(method).__name__ == "GetMe":
            from aiogram.types import User
            return User(id=42, is_bot=True, first_name="Duel", username="duelbot")
        return True


class RouterRaw:
    """FakeRaw + эфемерные сообщения."""
    def __init__(self, base):
        self.base = base
        self.ephemeral: list[dict] = []
        self.ephemeral_edits: list[str] = []
        self.fail_ephemeral = False
        self.answers: list[tuple] = []

    def __getattr__(self, n):
        return getattr(self.base, n)

    async def send_ephemeral(self, text, **kw):
        if self.fail_ephemeral and kw.get("receiver_user_id") == 2:
            raise BotApiError("sendMessage", 400, "Bad Request: not enough rights")
        self.ephemeral.append({"text": text, **kw})
        return {"ephemeral_message_id": 77}

    async def edit_ephemeral_text(self, chat_id, receiver, mid, text, **kw):
        self.ephemeral_edits.append(text)

    async def answer_widget_query(self, qid, data=None):
        self.answers.append((qid, data))


@pytest.fixture
async def env(db, monkeypatch):
    h = Harness(db, monkeypatch)
    session = StubSession()
    bot = Bot("42:TEST", session=session)
    raw = RouterRaw(h.raw)
    ctx = Ctx(raw, db, h.settings, h.service, h.leaderboard, h.providers, "duelbot")
    dp = DuelDispatcher()
    for o in (dp.message, dp.callback_query, dp.pre_checkout_query):
        o.outer_middleware(RegisterMiddleware(db))
    dp.include_router(build_router(ctx))
    install_widget_handler(dp, ctx)
    h.raw.h = h
    yield h, dp, bot, raw, session
    await bot.session.close()


def group_msg(uid, name, text, entities, mid=10, reply=None):
    m = {"message_id": mid, "date": 0, "chat": {"id": -100, "type": "supergroup", "title": "g"},
         "from": {"id": uid, "is_bot": False, "first_name": name, "username": name.lower()},
         "text": text, "entities": entities}
    if reply:
        m["reply_to_message"] = reply
    return {"update_id": mid, "message": m}


DUEL_ENT = [{"type": "bot_command", "offset": 0, "length": 5}]


async def test_widget_query_is_intercepted_and_always_answered(env):
    h, dp, bot, raw, _ = env
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    upd = {"update_id": 1, "widget_query": {
        "id": "Q1", "from": {"id": 1, "is_bot": False, "first_name": "P1"}, "chat": {"id": 1, "type": "private"},
        "message_id": h.players[1].msg_id, "chat_instance": "ci", "data": "hi"}}
    await dp.feed_raw_update(bot, upd)
    assert raw.answers and raw.answers[0][0] == "Q1"
    assert (await h.db.get_dp(duel.id, 1)).ready
    # запрос от неизвестного виджета тоже получает ответ (иначе у виджета будет TIMEOUT)
    await dp.feed_raw_update(bot, {"update_id": 2, "widget_query": {
        "id": "Q2", "from": {"id": 9, "is_bot": False, "first_name": "X"}, "chat": {"id": 9, "type": "private"},
        "message_id": 5, "chat_instance": "ci", "data": "p"}})
    assert raw.answers[-1][0] == "Q2" and json.loads(raw.answers[-1][1])["e"] == "late"


async def test_widget_query_exception_still_answers(env, monkeypatch):
    h, dp, bot, raw, _ = env
    async def boom(*a, **k):
        raise RuntimeError("x")
    monkeypatch.setattr(h.service, "on_widget_query", boom)
    await dp.feed_raw_update(bot, {"update_id": 1, "widget_query": {"id": "Q", "from": {"id": 1}, "data": "p"}})
    assert raw.answers == [("Q", '{"e":"bad"}')]


async def test_shared_widget_query_answered(env):
    h, dp, bot, raw, _ = env
    await dp.feed_raw_update(bot, {"update_id": 1, "shared_widget_query": {
        "id": "S1", "from": {"id": 5, "is_bot": False, "first_name": "F"}, "data": "x", "widget_id": "w"}})
    assert raw.answers == [("S1", None)]


async def test_duel_command_sends_private_challenge_to_target_only(env):
    h, dp, bot, raw, _ = env
    # Боб заранее писал в чат — бот его запомнил и может найти по @username
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/help", DUEL_ENT[:1] and [{"type": "bot_command", "offset": 0, "length": 5}], mid=1))
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @bobby", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 6}], mid=2))
    challenge = next(e for e in raw.ephemeral if e["receiver_user_id"] == 2)
    assert "Alice".lower() in challenge["text"].lower() or "@alice" in challenge["text"]
    cbs = [b["callback_data"] for row in challenge["reply_markup"]["inline_keyboard"] for b in row]
    assert cbs == ["d:a:1", "d:d:1"]
    ack = next(e for e in raw.ephemeral if e["receiver_user_id"] == 1)      # автору — отдельный эфемерный ответ
    assert "Вызов отправлен" in ack["text"]
    duel = await h.db.get_duel(1)
    assert duel.status.value == "challenged" and duel.ephemeral_id == 77 and duel.challenger_id == 1
    # во второй раз — блок: у игроков уже есть активная дуэль
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @bobby", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 6}], mid=3))
    assert "уже участвует" in raw.ephemeral[-1]["text"]


async def test_duel_command_unknown_user_and_self(env):
    h, dp, bot, raw, _ = env
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @ghost_user", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 11}], mid=2))
    assert "Не знаю такого игрока" in raw.ephemeral[-1]["text"]
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @alice", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 6}], mid=3))
    assert "с самим собой" in raw.ephemeral[-1]["text"]


async def test_duel_by_reply(env):
    h, dp, bot, raw, _ = env
    reply = {"message_id": 4, "date": 0, "chat": {"id": -100, "type": "supergroup", "title": "g"},
             "from": {"id": 2, "is_bot": False, "first_name": "Bobby", "username": "bob"}, "text": "hi"}
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel", DUEL_ENT, mid=5, reply=reply))
    assert any(e["receiver_user_id"] == 2 for e in raw.ephemeral)


async def test_challenge_fails_when_bot_is_not_admin(env):
    h, dp, bot, raw, _ = env
    raw.fail_ephemeral = True
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/help", [{"type": "bot_command", "offset": 0, "length": 5}], mid=1))
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @bobby", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 6}], mid=2))
    assert "администратором" in raw.ephemeral[-1]["text"]
    assert (await h.db.get_duel(1)).status.value == "cancelled"      # висящий вызов не остаётся


async def test_stake_commands_are_refused_when_disabled(env):
    h, dp, bot, raw, _ = env
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/help", [{"type": "bot_command", "offset": 0, "length": 5}], mid=1))
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @bobby 50 stars", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 6}], mid=2))
    assert "выключены" in raw.ephemeral[-1]["text"]
    assert await h.db.get_duel(1) is None


def cb_update(uid, name, data, uid_cb="cq1"):
    return {"update_id": 50, "callback_query": {
        "id": uid_cb, "from": {"id": uid, "is_bot": False, "first_name": name, "username": name.lower()},
        "chat_instance": "ci", "data": data}}


async def test_accept_and_decline_buttons(env):
    h, dp, bot, raw, session = env
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/help", [{"type": "bot_command", "offset": 0, "length": 5}], mid=1))
    await h.db.upsert_player(1, "alice", "Alice", True)
    await h.db.upsert_player(2, "bob", "Bobby", True)
    h.players = {1: Player(1), 2: Player(2)}
    duel = await h.new_duel(1, 2)
    await h.db.update_duel(duel.id, ephemeral_id=77)
    # чужой не может нажать
    await dp.feed_raw_update(bot, cb_update(1, "Alice", f"d:a:{duel.id}"))
    assert (await h.db.get_duel(duel.id)).status.value == "challenged"
    await dp.feed_raw_update(bot, cb_update(2, "Bobby", f"d:a:{duel.id}"))
    assert (await h.db.get_duel(duel.id)).status.value == "lobby"
    assert any("принят" in t for t in raw.ephemeral_edits)
    assert any(type(m).__name__ == "AnswerCallbackQuery" for m in session.calls)   # на callback отвечено
    # отказ
    d2 = await h.db.create_duel(-100, 2, 1, "none", 0, 60)  # Боб вызывает Алису, но у обоих уже есть дуэль
    assert d2.status.value == "challenged"


async def test_decline_button_cancels(env):
    h, dp, bot, raw, _ = env
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await dp.feed_raw_update(bot, cb_update(2, "Bobby", f"d:d:{duel.id}"))
    assert (await h.db.get_duel(duel.id)).reason == "declined"
    assert not await h.service.decline(duel.id, 2)               # повторно — уже нельзя
