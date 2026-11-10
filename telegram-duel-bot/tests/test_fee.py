"""Комиссия владельца с TON-ставок: одна транзакция из двух переводов, долг закрыт только при обоих."""
import json

import pytest
from pydantic import ValidationError

from duelbot.config import Settings
from duelbot.stakes.ton_utils import build_transaction, comment_boc_b64, fee_split, friendly
from tests.harness import Harness, Player
from tests.test_stakes_flow import PAYEE_RAW, PAYER_RAW, STAKE, card, join, ton_factory

FEE_WALLET = "UQA7piR2BSZsA7LBGvW_uoFUd0BEHGpA-zncuMDk5x_KFROG"


def test_fee_split_and_transaction():
    assert fee_split(1_000_000_000, 8) == (920_000_000, 80_000_000)
    assert fee_split(STAKE, 0) == (STAKE, 0)
    assert sum(fee_split(333_333_333, 8)) == 333_333_333            # ничего не теряется на округлении
    tx = build_transaction(PAYEE_RAW, 920, "duel:7", 0, "-239", fee_address=FEE_WALLET, fee_nano=80)
    assert [m["amount"] for m in tx["messages"]] == ["920", "80"]
    assert tx["messages"][1]["address"] == friendly(FEE_WALLET)
    assert tx["messages"][0]["payload"] == tx["messages"][1]["payload"]   # один комментарий duel:<id>
    assert len(build_transaction(PAYEE_RAW, 920, "duel:7", 0, "-239")["messages"]) == 1


def test_fee_needs_wallet():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, bot_token="x", ton_fee_percent=8)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, bot_token="x", ton_fee_percent=8, ton_fee_wallet="nope")
    assert Settings(_env_file=None, bot_token="x", ton_fee_percent=8, ton_fee_wallet=FEE_WALLET).ton_fee_percent == 8


def chain_tx(dst, value, duel_id, tx_hash):
    return {"hash": tx_hash, "emulated": False, "mc_block_seqno": 9, "description": {"aborted": False},
            "in_msg": {"source": PAYER_RAW, "destination": dst, "value": str(value), "bounced": False,
                       "message_content": {"body": comment_boc_b64(f"duel:{duel_id}")}}}


async def test_loser_pays_winner_and_fee_in_one_transaction(db, monkeypatch):
    h = Harness(db, monkeypatch, providers_factory=ton_factory, enable_ton_stakes=True,
                ton_fee_percent=8, ton_fee_wallet=FEE_WALLET)
    await h.add_players(Player(1, react_ms=150), Player(2, react_ms=320))
    duel = await h.new_duel(1, 2, "ton", STAKE)
    await h.service.accept(duel.id, 2)
    await h.hi(1)
    await h.hi(2)
    await join(h, 1, PAYEE_RAW)
    await join(h, 2, PAYER_RAW)
    d = await h.wait_done(duel.id)
    assert d.winner_id == 1
    assert "0.46 TON победителю и 0.04 TON комиссии (8%)" in d.settlement
    claim = await db.get_claim(duel.id)
    assert (claim.amount_nano, claim.fee_nano, claim.fee_address) == (460_000_000, 40_000_000, FEE_WALLET)

    tx = json.loads(await h.raw._query(h.players[2], "pay", qtype=card(PAYER_RAW)))
    assert [(m["address"], m["amount"]) for m in tx["messages"]] == [
        (friendly(PAYEE_RAW), "460000000"), (friendly(FEE_WALLET), "40000000")]

    ton = h.providers["ton"]
    h.toncenter.txs = [chain_tx(PAYEE_RAW, 460_000_000, duel.id, "WIN")]
    assert await ton.verify_claims() == []                           # только победителю — ещё не закрыт
    assert (await db.get_claim(duel.id)).tx_hash == "WIN"
    h.toncenter.txs.append(chain_tx(FEE_WALLET, 40_000_000, duel.id, "FEE"))
    assert [e for _, e in await ton.verify_claims()] == ["confirmed"]
    c = await db.get_claim(duel.id)
    assert (c.status, c.fee_tx_hash) == ("confirmed", "FEE")
