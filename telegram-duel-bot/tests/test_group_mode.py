"""Режим group: дуэль прямо в группе (сообщение с кнопкой) и комиссия с TON-ставок."""
import asyncio
import json
import time
from urllib.parse import unquote

import pytest
from pydantic import ValidationError

from duelbot.config import Settings
from duelbot.stakes.ton_utils import build_transaction, comment_boc_b64, fee_split, friendly, transfer_link
from tests.harness import Harness, Player
from tests.test_features import private_msg, sent_texts
from tests.test_router import cb_update, env, group_msg  # noqa: F401
from tests.test_stakes_flow import PAYEE_RAW, PAYER_RAW, STAKE, card, join, ton_factory

FEE_WALLET = "UQA7piR2BSZsA7LBGvW_uoFUd0BEHGpA-zncuMDk5x_KFROG"


def group_harness(db, monkeypatch, **kw):
    return Harness(db, monkeypatch, play_mode="group", **kw)


async def wait_for(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("condition not met")


WAIT, GO = "Руку на кобуру", "ЖМИ!  ЖМИ!"   # метки фаз: в тексте лобби тоже есть слово «ЖМИ!»


def edits_with(h, needle):
    return [e for e in h.bot.edits if needle in e["text"]]


async def play_group(h, duel, react: dict[int, float | None], early: dict[int, float] | None = None):
    """Оба жмут «Готов», дальше каждый жмёт «ОГОНЬ» через react[uid] мс после сигнала (или раньше)."""
    answers: dict[int, str] = {}
    for uid in duel.players:
        await h.service.on_ready(duel.id, uid)

    async def shooter(uid):
        if early and uid in early:
            await wait_for(lambda: edits_with(h, WAIT))
            await asyncio.sleep(early[uid] / 1000)
            answers[uid] = h.service.on_group_press(duel.id, uid, time.monotonic())
            return
        if react.get(uid) is None:
            return
        await wait_for(lambda: edits_with(h, GO))
        await asyncio.sleep(react[uid] / 1000)
        answers[uid] = h.service.on_group_press(duel.id, uid, time.monotonic())

    await asyncio.gather(*(shooter(u) for u in duel.players))
    return answers, await h.wait_done(duel.id)


async def test_group_duel_runs_in_one_message(db, monkeypatch):
    h = group_harness(db, monkeypatch)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    assert await h.service.accept(duel.id, 2) is None
    # в группе появилось сообщение дуэли с кнопкой «Готов»; виджеты в личку не отправлялись
    lobby_i = next(i for i, (c, t) in enumerate(h.bot.messages) if c == -100 and "Готов" in t)
    assert h.bot.markups[lobby_i].inline_keyboard[0][0].callback_data == f"d:g:{duel.id}"
    assert h.players[1].states == [] and h.players[2].states == []
    mid = (await db.get_duel(duel.id)).group_message_id
    assert mid is not None

    answers, d = await play_group(h, duel, {1: 150, 2: 320})
    assert d.outcome == "win" and d.winner_id == 1
    assert d.challenger_ms == pytest.approx(150, abs=60)
    assert answers == {1: "💥 Выстрел засчитан!", 2: "💥 Выстрел засчитан!"}
    # все стадии — правки одного и того же сообщения, итог тоже там, с кнопкой реванша
    assert {e["message_id"] for e in h.bot.edits} == {mid}
    texts = [e["text"] for e in h.bot.edits]
    assert any(WAIT in t for t in texts) and any(GO in t for t in texts)
    final = h.bot.edits[-1]
    assert "победил" in final["text"]
    assert final["reply_markup"].inline_keyboard[-1][0].callback_data == f"d:r:{duel.id}"
    # кнопка «ОГОНЬ» одинаковая до и после сигнала
    fire = [e["reply_markup"].inline_keyboard[0][0].callback_data for e in h.bot.edits[:-1]
            if e["reply_markup"] and "ОГОНЬ" in e["reply_markup"].inline_keyboard[0][0].text]
    assert set(fire) == {f"d:p:{duel.id}"} and len(fire) == 2


async def test_group_false_start_and_strangers(db, monkeypatch):
    h = group_harness(db, monkeypatch, delay_min=0.3, delay_max=0.4)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    assert h.service.on_group_press(duel.id, 1, time.monotonic()) == "Это не твоя дуэль 🙂"   # раунда ещё нет
    assert await h.service.on_ready(duel.id, 9) == "Это не твоя дуэль 🙂"
    answers, d = await play_group(h, duel, {}, early={2: 10})   # сигнала не будет: первому ждать нечего
    assert answers[2] == "🚫 Фальстарт!"
    assert d.winner_id == 1 and d.reason == "false_start"
    assert not edits_with(h, GO)                          # сигнал так и не подавался


async def test_group_ready_twice_and_timeout(db, monkeypatch):
    h = group_harness(db, monkeypatch, ready_ttl=1)
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    assert "Готов" in await h.service.on_ready(duel.id, 1)
    assert "✅" in h.bot.edits[-1]["text"] and "⏳" in h.bot.edits[-1]["text"]
    await db.update_duel(duel.id, deadline_at=time.time() - 1)
    await h.service.sweep_once()
    assert (await db.get_duel(duel.id)).reason == "timeout"
    assert "отменена" in h.bot.edits[-1]["text"]             # итог написан в том же сообщении


async def test_router_fire_button_uses_receive_time(env, monkeypatch):
    h, dp, bot, raw, session = env
    h.settings.play_mode = "group"
    h.service.group = True
    await h.add_players(Player(1), Player(2))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    await dp.feed_raw_update(bot, cb_update(1, "P1", f"d:g:{duel.id}", uid_cb="g1"))
    await dp.feed_raw_update(bot, cb_update(2, "P2", f"d:g:{duel.id}", uid_cb="g2"))
    await wait_for(lambda: edits_with(h, GO))
    await asyncio.sleep(0.12)
    await dp.feed_raw_update(bot, cb_update(2, "P2", f"d:p:{duel.id}", uid_cb="p2"))
    await asyncio.sleep(0.1)
    await dp.feed_raw_update(bot, cb_update(1, "P1", f"d:p:{duel.id}", uid_cb="p1"))
    d = await h.wait_done(duel.id)
    assert d.winner_id == 2
    answers = [m.text for m in session.calls if type(m).__name__ == "AnswerCallbackQuery"]
    assert "💥 Выстрел засчитан!" in answers


# ---------------- комиссия TON ----------------
def test_fee_split_and_links():
    assert fee_split(1_000_000_000, 8) == (920_000_000, 80_000_000)
    assert fee_split(STAKE, 0) == (STAKE, 0)
    assert sum(fee_split(333_333_333, 8)) == 333_333_333            # ничего не теряется на округлении
    link = transfer_link(FEE_WALLET, 80_000_000, "duel:7")
    assert link.startswith(f"https://app.tonkeeper.com/transfer/{friendly(FEE_WALLET)}?amount=80000000&text=")
    assert unquote(link.split("text=")[1]) == "duel:7"
    tx = build_transaction(PAYEE_RAW, 920, "duel:7", 0, "-239", fee_address=FEE_WALLET, fee_nano=80)
    assert [m["amount"] for m in tx["messages"]] == ["920", "80"]
    assert tx["messages"][1]["address"] == friendly(FEE_WALLET)


def test_fee_needs_wallet():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, bot_token="x", ton_fee_percent=8)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, bot_token="x", ton_fee_percent=8, ton_fee_wallet="nope")
    s = Settings(_env_file=None, bot_token="x", ton_fee_percent=8, ton_fee_wallet=FEE_WALLET)
    assert s.ton_fee_percent == 8


def chain_tx(h, dst, value, duel_id, tx_hash):
    return {"hash": tx_hash, "emulated": False, "mc_block_seqno": 9, "description": {"aborted": False},
            "in_msg": {"source": PAYER_RAW, "destination": dst, "value": str(value), "bounced": False,
                       "message_content": {"body": comment_boc_b64(f"duel:{duel_id}")}}}


async def test_group_ton_stake_with_fee(db, monkeypatch):
    h = group_harness(db, monkeypatch, providers_factory=ton_factory, enable_ton_stakes=True,
                      ton_fee_percent=8, ton_fee_wallet=FEE_WALLET)
    await h.add_players(Player(1), Player(2))
    await db.set_ton_wallet(1, PAYEE_RAW)
    await db.set_ton_wallet(2, PAYER_RAW)
    duel = await h.new_duel(1, 2, "ton", STAKE)
    assert await h.service.accept(duel.id, 2) is None
    assert (await db.get_duel(duel.id)).status.value == "lobby"    # кошельки известны — сразу к «Готов»
    _, d = await play_group(h, duel, {1: 150, 2: 320})
    assert d.winner_id == 1
    claim = await db.get_claim(duel.id)
    assert (claim.amount_nano, claim.fee_nano) == (460_000_000, 40_000_000)
    assert claim.fee_address == FEE_WALLET
    # в итоге — две ссылки на оплату и реванш
    final = h.bot.edits[-1]
    assert "0.46 TON победителю и 0.04 TON комиссии (8%)" in final["text"]
    rows = final["reply_markup"].inline_keyboard
    assert "amount=460000000" in rows[0][0].url and friendly(PAYEE_RAW) in rows[0][0].url
    assert "amount=40000000" in rows[1][0].url and friendly(FEE_WALLET) in rows[1][0].url
    assert rows[2][0].callback_data == f"d:r:{duel.id}"

    ton = h.providers["ton"]
    # заплатил только победителю — долг ещё не закрыт
    h.toncenter.txs = [chain_tx(h, PAYEE_RAW, 460_000_000, duel.id, "WIN")]
    assert await ton.verify_claims() == []
    assert (await db.get_claim(duel.id)).tx_hash == "WIN"
    # пришла и комиссия — закрыт
    h.toncenter.txs.append(chain_tx(h, FEE_WALLET, 40_000_000, duel.id, "FEE"))
    assert [e for _, e in await ton.verify_claims()] == ["confirmed"]
    c = await db.get_claim(duel.id)
    assert (c.status, c.fee_tx_hash) == ("confirmed", "FEE")


async def test_dm_mode_fee_goes_into_one_wallet_transaction(db, monkeypatch):
    h = Harness(db, monkeypatch, providers_factory=ton_factory, enable_ton_stakes=True,
                ton_fee_percent=8, ton_fee_wallet=FEE_WALLET)
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=320))
    duel = await h.new_duel(1, 2, "ton", STAKE)
    await h.service.accept(duel.id, 2)
    await h.hi(1)
    await h.hi(2)
    await join(h, 1, PAYEE_RAW)
    await join(h, 2, PAYER_RAW)
    await h.wait_done(duel.id)
    tx = json.loads(await h.raw._query(h.players[2], "pay", qtype=card(PAYER_RAW)))
    assert [m["amount"] for m in tx["messages"]] == ["460000000", "40000000"]


# ---------------- команды ----------------
async def test_wallet_command(env):
    h, dp, bot, raw, session = env
    await dp.feed_raw_update(bot, private_msg(1, "Alice", "/cwallet"))
    assert "не указан" in sent_texts(session)[-1]
    await dp.feed_raw_update(bot, private_msg(1, "Alice", "/cwallet мусор", mid=21))
    assert "не похоже" in sent_texts(session)[-1]
    await dp.feed_raw_update(bot, private_msg(1, "Alice", f"/cwallet {PAYEE_RAW}", mid=22))
    assert "сохранён" in sent_texts(session)[-1]
    assert (await h.db.get_player(1)).ton_wallet == friendly(PAYEE_RAW)


async def test_top_in_group_mode_is_text_in_chat(env):
    h, dp, bot, raw, session = env
    h.settings.play_mode = "group"
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/ctop", [{"type": "bot_command", "offset": 0, "length": 5}]))
    assert "Пока пусто" in sent_texts(session)[-1]
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=300))
    duel = await h.new_duel(1, 2)
    await h.service.accept(duel.id, 2)
    await asyncio.gather(h.hi(1), h.hi(2))
    await h.wait_done(duel.id)
    await dp.feed_raw_update(bot, group_msg(1, "Alice", "/ctop", [{"type": "bot_command", "offset": 0, "length": 5}], mid=11))
    top = sent_texts(session)[-1]
    assert "🥇" in top and "1016" in top and "🥈" in top
