import asyncio
import json
import time

from duelbot.stakes.stars import StarsStakeProvider, make_payload
from duelbot.stakes.ton import TonStakeProvider
from duelbot.stakes.ton_utils import comment_boc_b64, friendly
from tests.harness import Harness, Player

# ======================= Stars =======================


def stars_factory(h):
    return {"stars": StarsStakeProvider(h.bot, h.db, h.settings)}


async def stars_duel(db, monkeypatch, a, b, **settings):
    h = Harness(db, monkeypatch, providers_factory=stars_factory, enable_stars_stakes=True, **settings)
    await h.add_players(a, b)
    duel = await h.new_duel(a.uid, b.uid, "stars", 50)
    assert await h.service.accept(duel.id, b.uid) is None
    return h, duel


async def pay(h, duel, uid, charge):
    stars = h.providers["stars"]
    assert await stars.check_pre_checkout(uid, "XTR", duel.stake_amount, make_payload(duel.id, uid)) is None
    d = await stars.on_successful_payment(uid, duel.stake_amount, make_payload(duel.id, uid), charge)
    if d:
        await h.service.on_funded(d.id)
    return d


async def test_invoices_sent_to_both_and_widget_shows_stake_phase(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1), Player(2))
    assert sorted(i["chat_id"] for i in h.bot.invoices) == [1, 2]
    inv = h.bot.invoices[0]
    assert inv["currency"] == "XTR" and inv["provider_token"] == "" and inv["prices"][0].amount == 50
    assert h.players[1].states[0]["p"] == "stake" and h.players[1].states[0]["k"] == "s"
    # пока не оплатили — раунд не стартует, даже если виджеты открыты
    await h.hi(1); await h.hi(2)
    await asyncio.sleep(0.2)
    assert (await db.get_duel(duel.id)).status.value == "staking"


async def test_stars_winner_gets_own_stake_back_loser_stake_retained(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=320))
    await h.hi(1); await h.hi(2)
    await pay(h, duel, 1, "chA"); await pay(h, duel, 2, "chB")
    d = await h.wait_done(duel.id)
    assert d.winner_id == 1
    assert h.bot.refunds == [(1, "chA")]                      # вернули только ставку победителя
    pays = {p.charge_id: p.status for p in await db.star_payments(duel.id)}
    assert pays == {"chA": "refunded", "chB": "retained"}
    assert "ставка проигравшего остаётся у бота" in d.settlement
    assert any("победил" in t and "ставка проигравшего" in t for _, t in h.bot.messages)


async def test_stars_draw_refunds_both(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1, react_ms=200), Player(2, react_ms=205), tie_ms=40.0)
    await h.hi(1); await h.hi(2)
    await pay(h, duel, 1, "chA"); await pay(h, duel, 2, "chB")
    d = await h.wait_done(duel.id)
    assert d.outcome == "draw"
    assert sorted(h.bot.refunds) == [(1, "chA"), (2, "chB")]


async def test_stars_cancel_refunds_what_was_paid(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1), Player(2))
    await pay(h, duel, 1, "chA")                              # второй так и не оплатил
    await db.update_duel(duel.id, deadline_at=time.time() - 1)
    await h.service.sweep_once()
    assert (await db.get_duel(duel.id)).status.value == "cancelled"
    assert h.bot.refunds == [(1, "chA")]


async def test_nobody_presses_refunds_both_stars(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1, react_ms=None), Player(2, react_ms=None),
                               response_timeout=0.3)
    await h.hi(1); await h.hi(2)
    await pay(h, duel, 1, "chA"); await pay(h, duel, 2, "chB")
    d = await h.wait_done(duel.id)
    assert d.status.value == "cancelled" and sorted(h.bot.refunds) == [(1, "chA"), (2, "chB")]


async def test_pre_checkout_rejections(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1), Player(2))
    s = h.providers["stars"]
    assert await s.check_pre_checkout(1, "USD", 50, make_payload(duel.id, 1))              # не XTR
    assert await s.check_pre_checkout(1, "XTR", 49, make_payload(duel.id, 1))              # не та сумма
    assert await s.check_pre_checkout(2, "XTR", 50, make_payload(duel.id, 1))              # чужой счёт
    assert await s.check_pre_checkout(1, "XTR", 50, "garbage")
    assert await s.check_pre_checkout(1, "XTR", 50, make_payload(999, 1))
    await pay(h, duel, 1, "chA")
    assert "уже внесли" in await s.check_pre_checkout(1, "XTR", 50, make_payload(duel.id, 1))


async def test_duplicate_successful_payment_is_ignored(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1), Player(2))
    s = h.providers["stars"]
    assert await s.on_successful_payment(1, 50, make_payload(duel.id, 1), "chA")
    assert await s.on_successful_payment(1, 50, make_payload(duel.id, 1), "chA") is None
    assert len(await db.star_payments(duel.id)) == 1


async def test_late_payment_after_cancel_is_refunded_immediately(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1), Player(2))
    await h.service.cancel_duel(duel.id, __import__("duelbot.engine.models", fromlist=["Reason"]).Reason.TIMEOUT)
    s = h.providers["stars"]
    assert await s.on_successful_payment(2, 50, make_payload(duel.id, 2), "chLate") is None
    assert h.bot.refunds == [(2, "chLate")]


async def test_failed_refund_is_retried(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=320))
    h.bot.fail_refund_for = {"chA"}
    await h.hi(1); await h.hi(2)
    await pay(h, duel, 1, "chA"); await pay(h, duel, 2, "chB")
    d = await h.wait_done(duel.id)
    assert "не удалось вернуть" in d.settlement.lower()
    assert [p.charge_id for p in await db.failed_refunds()] == ["chA"]
    h.bot.fail_refund_for = set()
    assert await h.providers["stars"].retry_failed_refunds() == 1
    assert h.bot.refunds == [(1, "chA")] and await db.failed_refunds() == []


async def test_winner_gift_is_sent_when_configured(db, monkeypatch):
    h, duel = await stars_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=320),
                               stars_winner_gift_id="gift42")
    await h.hi(1); await h.hi(2)
    await pay(h, duel, 1, "chA"); await pay(h, duel, 2, "chB")
    await h.wait_done(duel.id)
    assert h.bot.gifts and h.bot.gifts[0]["user_id"] == 1 and h.bot.gifts[0]["gift_id"] == "gift42"


def test_stars_validation_bounds_and_switch(db, monkeypatch):
    from duelbot.config import Settings
    from duelbot.stakes.base import StakeKind, StakeSpec
    from duelbot.storage.db import Player as P
    pa, pb = P(1, "a", "A", True), P(2, "b", "B", True)
    off = StarsStakeProvider(None, None, Settings(_env_file=None, bot_token="x"))
    assert off.validate(StakeSpec(StakeKind.STARS, 5), pa, pb)                       # выключено
    on = StarsStakeProvider(None, None, Settings(_env_file=None, bot_token="x", enable_stars_stakes=True,
                                                 stars_min=5, stars_max=100))
    assert on.validate(StakeSpec(StakeKind.STARS, 5), pa, pb) is None
    assert on.validate(StakeSpec(StakeKind.STARS, 4), pa, pb) and on.validate(StakeSpec(StakeKind.STARS, 101), pa, pb)


# ======================= TON =======================
PAYEE_RAW = "0:" + "11" * 32
PAYER_RAW = "0:" + "22" * 32
STAKE = 500_000_000


class FakeToncenter:
    def __init__(self):
        self.txs: list[dict] = []
        self.calls: list[tuple] = []

    async def account_transactions(self, account, start_utime, limit=50):
        self.calls.append((account, start_utime))
        return self.txs


def ton_factory(h):
    h.toncenter = FakeToncenter()
    return {"ton": TonStakeProvider(h.db, h.settings, h.toncenter)}


def card(address, balance=5_000_000_000):
    return {"type": "data", "wallet_card": {"address": address, "amount": str(balance), "stickers": []}}


async def ton_duel(db, monkeypatch, a, b, **settings):
    h = Harness(db, monkeypatch, providers_factory=ton_factory, enable_ton_stakes=True, **settings)
    await h.add_players(a, b)
    duel = await h.new_duel(a.uid, b.uid, "ton", STAKE)
    assert await h.service.accept(duel.id, b.uid) is None
    return h, duel


async def join(h, uid, address, balance=5_000_000_000):
    return await h.raw._query(h.players[uid], "join", qtype=card(address, balance))


async def test_ton_join_checks_wallet_and_balance(db, monkeypatch):
    h, duel = await ton_duel(db, monkeypatch, Player(1), Player(2))
    assert h.players[1].states[0]["p"] == "stake" and h.players[1].states[0]["k"] == "t"
    assert json.loads(await h.raw._query(h.players[1], "join"))["e"] == "nw"          # нет карточки кошелька
    assert json.loads(await join(h, 1, "not-an-address"))["e"] == "nw"
    assert json.loads(await join(h, 1, PAYEE_RAW, balance=STAKE))["e"] == "low"       # нет запаса на комиссию
    assert not (await db.get_dp(duel.id, 1)).funded
    assert "e" in json.loads(await join(h, 1, PAYEE_RAW))                             # принято
    assert (await db.get_dp(duel.id, 1)).funded


async def test_ton_full_flow_loser_pays_winner_and_bot_verifies_on_chain(db, monkeypatch):
    h, duel = await ton_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=320))
    await h.hi(1); await h.hi(2)
    await join(h, 1, PAYEE_RAW); await join(h, 2, PAYER_RAW)
    d = await h.wait_done(duel.id)
    assert d.winner_id == 1 and d.loser_id == 2
    claim = await db.get_claim(duel.id)
    assert (claim.payer_id, claim.payee_id, claim.payee_address) == (2, 1, PAYEE_RAW)
    assert claim.amount_nano == STAKE and claim.comment == f"duel:{duel.id}" and claim.status == "pending"
    # виджеты: проигравший видит кнопку «Заплатить», победитель — «ждём оплату»
    assert h.players[2].states[-1]["q"] == "o" and h.players[1].states[-1]["q"] == "w"
    assert h.players[2].states[-1]["a"] == "0.5"

    # проигравший нажал «Заплатить»: бот отдаёт готовую транзакцию для кошелька
    tx = json.loads(await h.raw._query(h.players[2], "pay", qtype=card(PAYER_RAW)))
    assert tx["network"] == "-239" and tx["messages"][0]["address"] == friendly(PAYEE_RAW)
    assert tx["messages"][0]["amount"] == str(STAKE)
    # чужой игрок не может запросить оплату
    assert json.loads(await h.raw._query(h.players[1], "pay", qtype=card(PAYEE_RAW)))["e"] == "bad"

    # кошелёк сообщил об отправке
    await h.raw._query(h.players[2], f"paid:{duel.id}", qtype={
        "type": "sent_transaction", "msg_hash": "MH", "wallet": {"address": PAYER_RAW, "amount": "1"}})
    assert (await db.get_claim(duel.id)).status == "tx_reported"
    # одного сообщения кошелька недостаточно: пока в цепочке ничего нет — не подтверждаем
    ton = h.providers["ton"]
    assert await ton.verify_claims() == []
    assert (await db.get_claim(duel.id)).status == "tx_reported"

    # платёж появился в цепочке
    h.toncenter.txs = [{
        "hash": "CHAINHASH", "emulated": False, "mc_block_seqno": 777, "description": {"aborted": False},
        "in_msg": {"source": PAYER_RAW, "destination": PAYEE_RAW, "value": str(STAKE), "bounced": False,
                   "message_content": {"body": comment_boc_b64(f"duel:{duel.id}")}}}]
    events = await ton.verify_claims()
    assert [e for _, e in events] == ["confirmed"]
    await h.service._notify_claim(*events[0])
    c = await db.get_claim(duel.id)
    assert c.status == "confirmed" and c.tx_hash == "CHAINHASH"
    assert any("заплатил" in t for _, t in h.bot.messages)
    await asyncio.sleep(0.1)                      # пуши в виджеты доставляются асинхронно
    assert h.players[1].states[-1]["q"] == "p" and h.players[2].states[-1]["q"] == "p"
    assert await ton.verify_claims() == []                                           # повторно не шлём


async def test_ton_unpaid_blocks_loser_until_payment_arrives(db, monkeypatch):
    h, duel = await ton_duel(db, monkeypatch, Player(1, react_ms=150), Player(2, react_ms=320))
    await h.hi(1); await h.hi(2)
    await join(h, 1, PAYEE_RAW); await join(h, 2, PAYER_RAW)
    await h.wait_done(duel.id)
    ton = h.providers["ton"]
    await db.update_claim(duel.id, deadline_at=time.time() - 1)
    events = await ton.verify_claims()
    assert [e for _, e in events] == ["unpaid"]
    await h.service._notify_claim(*events[0])
    loser = await db.get_player(2)
    assert loser.ton_blocked
    pa, pb = await db.get_player(1), loser
    from duelbot.stakes.base import StakeKind, StakeSpec
    assert "не оплатил" in ton.validate(StakeSpec(StakeKind.TON, STAKE), pa, pb)
    # запоздалая оплата снимает блокировку
    await db.update_claim(duel.id, payer_address=PAYER_RAW)
    h.toncenter.txs = [{
        "hash": "LATE", "emulated": False, "mc_block_seqno": 5, "description": {"aborted": False},
        "in_msg": {"source": PAYER_RAW, "destination": PAYEE_RAW, "value": str(STAKE), "bounced": False,
                   "message_content": {"body": comment_boc_b64(f"duel:{duel.id}")}}}]
    assert [e for _, e in await ton.verify_claims()] == ["confirmed"]
    assert not (await db.get_player(2)).ton_blocked


async def test_ton_draw_creates_no_claim(db, monkeypatch):
    h, duel = await ton_duel(db, monkeypatch, Player(1, react_ms=200), Player(2, react_ms=205), tie_ms=40.0)
    await h.hi(1); await h.hi(2)
    await join(h, 1, PAYEE_RAW); await join(h, 2, PAYER_RAW)
    d = await h.wait_done(duel.id)
    assert d.outcome == "draw" and await db.get_claim(duel.id) is None


def test_ton_validation(db, monkeypatch):
    from duelbot.config import Settings
    from duelbot.stakes.base import StakeKind, StakeSpec
    from duelbot.storage.db import Player as P
    pa, pb = P(1, "a", "A", True), P(2, "b", "B", True)
    s = Settings(_env_file=None, bot_token="x", enable_ton_stakes=True, ton_min=0.1, ton_max=2)
    ton = TonStakeProvider(None, s, None)
    assert ton.validate(StakeSpec(StakeKind.TON, 500_000_000), pa, pb) is None
    assert ton.validate(StakeSpec(StakeKind.TON, 50_000_000), pa, pb)               # меньше минимума
    assert ton.validate(StakeSpec(StakeKind.TON, 3_000_000_000), pa, pb)            # больше максимума
    off = TonStakeProvider(None, Settings(_env_file=None, bot_token="x"), None)
    assert off.validate(StakeSpec(StakeKind.TON, 500_000_000), pa, pb)
