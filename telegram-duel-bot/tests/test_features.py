"""Рейтинг, реванш, /cancel, /stats, защита от спама вызовами, валидация настроек."""
import asyncio

import pytest
from pydantic import ValidationError

from duelbot.config import Settings
from duelbot.engine.models import Reason
from duelbot.engine.states import Status
from duelbot.texts import plural, signed
from tests.harness import Harness, Player
from tests.test_router import DUEL_ENT, cb_update, env, group_msg  # noqa: F401  (фикстура env)


def private_msg(uid, name, text, mid=20):
    return {"update_id": mid, "message": {
        "message_id": mid, "date": 0, "chat": {"id": uid, "type": "private", "first_name": name},
        "from": {"id": uid, "is_bot": False, "first_name": name, "username": name.lower()},
        "text": text, "entities": [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}]}}


def sent_texts(session):
    return [m.text for m in session.calls if type(m).__name__ == "SendMessage"]


async def play(h, a=1, b=2):
    duel = await h.new_duel(a, b)
    assert await h.service.accept(duel.id, b) is None
    await asyncio.gather(h.hi(a), h.hi(b))
    return await h.wait_done(duel.id)


async def test_result_has_rating_and_rematch_button(env):
    h, dp, bot, raw, _ = env
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=300))
    d = await play(h)
    assert (d.challenger_delta, d.target_delta) == (16, -16)
    text = next(t for c, t in h.bot.messages if c == -100)
    assert "📈" in text and "1016 (+16)" in text and "984 (−16)" in text
    markup = h.bot.markups[h.bot.messages.index((-100, text))]
    assert markup.inline_keyboard[0][0].callback_data == f"d:r:{d.id}"
    # виджет победителя получил новый рейтинг и изменение
    final = h.players[1].states[-1]
    assert (final["p"], final["rt"], final["dr"]) == ("win", 1016, 16)


async def test_rematch_creates_new_challenge_for_opponent(env):
    h, dp, bot, raw, session = env
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=300))
    d = await play(h)
    # посторонний не может предложить реванш
    await dp.feed_raw_update(bot, cb_update(3, "Eve", f"d:r:{d.id}"))
    assert len(raw.ephemeral) == 0
    # проигравший предлагает реванш: вызов уходит победителю
    await dp.feed_raw_update(bot, cb_update(2, "P2", f"d:r:{d.id}"))
    new = await h.db.active_duel_for(2)
    assert new is not None and (new.challenger_id, new.target_id, new.chat_id) == (2, 1, -100)
    assert raw.ephemeral[-1]["receiver_user_id"] == 1
    # повторное нажатие — уже есть активная дуэль
    await dp.feed_raw_update(bot, cb_update(2, "P2", f"d:r:{d.id}", uid_cb="cq2"))
    assert len([e for e in raw.ephemeral if e["receiver_user_id"] == 1]) == 1


async def test_cancel_own_challenge(env):
    h, dp, bot, raw, _ = env
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/help", [{"type": "bot_command", "offset": 0, "length": 5}], mid=1))
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @bobby", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 6}], mid=2))
    assert "/ccancel" in raw.ephemeral[-1]["text"]
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/ccancel", [{"type": "bot_command", "offset": 0, "length": 7}], mid=3))
    duel = await h.db.get_duel(1)
    assert duel.status.value == "cancelled" and duel.reason == Reason.WITHDRAWN.value
    assert "отменена" in raw.ephemeral[-1]["text"]
    assert raw.ephemeral_edits[-1] == "Вызов отозван."          # приглашение у Боба обновилось
    assert not any("не принял" in t for _, t in h.bot.messages)
    # отменять больше нечего
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/ccancel", [{"type": "bot_command", "offset": 0, "length": 7}], mid=4))
    assert "нет активных" in raw.ephemeral[-1]["text"]


async def test_cancel_after_accept_notifies_opponent(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    assert "отменена" in await h.service.withdraw(2)
    await asyncio.sleep(0.05)
    assert (await db.get_duel(duel.id)).reason == "withdrawn"
    assert any(chat == 1 and "отменил дуэль" in t for chat, t in h.bot.messages)
    assert h.phases(1)[-1] == "cancel"


async def test_cancel_refused_during_round(db, monkeypatch):
    h = Harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.db.transition(duel.id, Status.LOBBY)
    await h.db.transition(duel.id, Status.ROUND)
    assert "уже идёт" in await h.service.withdraw(1)


async def test_rechallenge_cooldown_after_decline(env):
    h, dp, bot, raw, _ = env
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/help", [{"type": "bot_command", "offset": 0, "length": 5}], mid=1))
    duel_cmd = lambda mid: group_msg(1, "Alice", "/cduel @bobby", DUEL_ENT + [  # noqa: E731
        {"type": "mention", "offset": 6, "length": 6}], mid=mid)
    await dp.feed_raw_update(bot, duel_cmd(2))
    await dp.feed_raw_update(bot, cb_update(2, "Bobby", "d:d:1"))
    await dp.feed_raw_update(bot, duel_cmd(3))
    assert "недавно отказался" in raw.ephemeral[-1]["text"]
    assert await h.db.get_duel(2) is None
    h.settings.challenge_cooldown = 0
    await dp.feed_raw_update(bot, duel_cmd(4))
    assert (await h.db.get_duel(2)).status.value == "challenged"


async def test_aborted_challenge_does_not_claim_timeout(env):
    h, dp, bot, raw, _ = env
    raw.fail_ephemeral = True
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/help", [{"type": "bot_command", "offset": 0, "length": 5}], mid=1))
    await h.db.set_can_dm(1, True)
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel @bobby", DUEL_ENT + [
        {"type": "mention", "offset": 6, "length": 6}], mid=2))
    assert (await h.db.get_duel(1)).reason == "aborted"
    assert not any("не принял" in t for _, t in h.bot.messages)


async def test_stats_card_is_a_widget(env):
    import json

    from duelbot.widgets.render import stats_html
    h, dp, bot, raw, session = env
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=300))
    await play(h)
    await dp.feed_raw_update(bot, private_msg(1, "P1", "/cstats"))
    w = raw.widgets[-1]
    card = json.loads(w["chat_data"])
    assert w["chat_id"] == 1 and w["html"] == stats_html() and w["allow_queries"] is True
    assert (card["u"], card["rt"], card["rk"], card["w"], card["s"]) == (1, 1016, 1, 1, 1)
    # из группы: чужая карточка уходит спросившему в личку, в группе — только эфемерная пометка
    await h.db.upsert_player(2, "bobby", "Bob")
    await dp.feed_raw_update(bot, group_msg(5, "Zed", "/cstats @bobby", [{"type": "bot_command", "offset": 0, "length": 7},
                                                                           {"type": "mention", "offset": 8, "length": 6}], mid=30))
    w = raw.widgets[-1]
    assert w["chat_id"] == 5 and json.loads(w["chat_data"])["rt"] == 984
    assert "в личку" in raw.ephemeral[-1]["text"] and raw.ephemeral[-1]["receiver_user_id"] == 5
    # не нажал Start — кнопка с deep-link
    raw.base.unreachable.add(6)
    await dp.feed_raw_update(bot, group_msg(6, "Max", "/cstats", [{"type": "bot_command", "offset": 0, "length": 7}], mid=31))
    assert any("Start" in (t or "") for t in sent_texts(session))
    # открытая карточка сама просит свежие цифры
    fresh = await h.service.on_widget_query({"id": "q", "from": {"id": 5}, "chat": {"id": 5}, "message_id": 901,
                                             "data": "st:2"}, 0.0)
    assert json.loads(fresh)["rt"] == 984


async def test_rematch_from_widget(env):
    import json
    h, dp, bot, raw, session = env
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=300))
    d = await play(h)
    answer = await h.raw._query(h.players[2], "rematch")
    assert json.loads(answer)["e"] == "вызов отправлен в группу 🤠"
    new = await h.db.active_duel_for(2)
    assert (new.challenger_id, new.target_id, new.chat_id) == (2, 1, d.chat_id)
    assert raw.ephemeral[-1]["receiver_user_id"] == 1
    # второй раз — уже есть активная дуэль, ответ объясняет почему
    again = json.loads(await h.raw._query(h.players[1], "rematch"))["e"]
    assert "уже участвует" in again


async def test_duel_in_private_with_unknown_user_suggests_search(env):
    h, dp, bot, raw, session = env
    await dp.feed_raw_update(bot, private_msg(1, "Alice", "/cduel @nobody_here"))
    assert "/cfind" in sent_texts(session)[-1]
    assert await h.db.get_duel(1) is None


def test_texts_helpers():
    assert [plural(n, "победа", "победы", "побед") for n in (1, 3, 5, 11, 21, 24)] == [
        "1 победа", "3 победы", "5 побед", "11 побед", "21 победа", "24 победы"]
    assert (signed(5), signed(-3), signed(0)) == ("+5", "−3", "±0")


@pytest.mark.parametrize("bad", [dict(delay_min=5, delay_max=2), dict(stars_min=10, stars_max=5),
                                 dict(ton_min=0), dict(ton_network="1"), dict(challenge_ttl=0),
                                 dict(default_rtt_ms=500, max_rtt_ms=400), dict(log_level="LOUD")])
def test_settings_reject_nonsense(bad):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, bot_token="x", **bad)


async def test_group_ignores_generic_command_names_of_other_bots(env):
    h, dp, bot, raw, session = env
    await dp.feed_raw_update(bot, group_msg(2, "Bobby", "/chelp", [{"type": "bot_command", "offset": 0, "length": 6}], mid=1))
    assert "/cduel" in sent_texts(session)[-1]
    before = (len(sent_texts(session)), len(raw.ephemeral))
    for mid, text in enumerate(("/duel @bobby", "/help", "/stats", "/top", "/cancel"), start=2):
        await dp.feed_raw_update(bot, group_msg(1, "Alice", text, [
            {"type": "bot_command", "offset": 0, "length": len(text.split()[0])}], mid=mid))
    assert (len(sent_texts(session)), len(raw.ephemeral)) == before     # чужие команды бот не трогает
    assert await h.db.get_duel(1) is None
    # /cduel@другой_бот — тоже не нам
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/cduel@other_bot @bobby", [
        {"type": "bot_command", "offset": 0, "length": 16}], mid=9))
    assert await h.db.get_duel(1) is None
