import pytest

from duelbot.stakes.ton_utils import (
    build_transaction,
    comment_boc_b64,
    decode_comment,
    format_ton,
    friendly,
    match_payment,
    same_address,
    to_nano,
)

PAYEE_RAW = "0:" + "11" * 32
PAYER_RAW = "0:" + "22" * 32
OTHER_RAW = "0:" + "33" * 32
AMOUNT = 500_000_000


def tx(**over):
    base = {
        "hash": "TXHASH", "emulated": False, "mc_block_seqno": 42, "description": {"aborted": False},
        "in_msg": {"source": PAYER_RAW, "destination": PAYEE_RAW, "value": str(AMOUNT), "bounced": False,
                   "message_content": {"body": comment_boc_b64("duel:7")}},
    }
    base["in_msg"].update(over.pop("in_msg", {}))
    base.update(over)
    return base


def match(txs, **kw):
    args = dict(payee_address=PAYEE_RAW, senders={PAYER_RAW}, amount_nano=AMOUNT, comment="duel:7")
    args.update(kw)
    return match_payment(transactions=txs, **args)


def test_to_nano_and_format():
    assert to_nano("0.5") == 500_000_000 and to_nano("1,25") == 1_250_000_000
    assert format_ton(500_000_000) == "0.5" and format_ton(2_000_000_000) == "2"
    for bad in ("0", "-1", "abc", "0.0000000001"):
        with pytest.raises(ValueError):
            to_nano(bad)


def test_comment_roundtrip():
    assert decode_comment(comment_boc_b64("duel:123")) == "duel:123"
    assert decode_comment("not base64!!") is None
    assert decode_comment(None) is None


def test_address_friendly_and_same():
    f = friendly(PAYEE_RAW)
    assert f != PAYEE_RAW and same_address(f, PAYEE_RAW)
    assert not same_address(PAYEE_RAW, PAYER_RAW)
    assert not same_address("garbage", PAYEE_RAW)


def test_build_transaction_format_and_size():
    t = build_transaction(PAYEE_RAW, AMOUNT, "duel:7", now=1_000_000, network="-239")
    assert t["valid_until"] == 1_000_600 and t["network"] == "-239"
    (m,) = t["messages"]
    assert m["amount"] == "500000000" and m["address"] == friendly(PAYEE_RAW)
    assert decode_comment(m["payload"]) == "duel:7"
    assert "from" not in t
    import json
    assert len(json.dumps(t, separators=(",", ":")).encode()) <= 1024   # лимит ответа на widget_query


def test_match_payment_happy_path():
    m = match([tx()])
    assert m and m.tx_hash == "TXHASH" and m.value_nano == AMOUNT


def test_match_payment_accepts_overpay_and_friendly_addresses():
    assert match([tx(in_msg={"value": str(AMOUNT * 2), "source": friendly(PAYER_RAW),
                             "destination": friendly(PAYEE_RAW)})])


@pytest.mark.parametrize("name,t", [
    ("emulated", tx(emulated=True)),
    ("aborted", tx(description={"aborted": True})),
    ("bounced", tx(in_msg={"bounced": True})),
    ("no_masterchain_confirmation", tx(mc_block_seqno=None)),
    ("underpaid", tx(in_msg={"value": str(AMOUNT - 1)})),
    ("wrong_comment", tx(in_msg={"message_content": {"body": comment_boc_b64("duel:8")}})),
    ("no_comment", tx(in_msg={"message_content": {"body": None}})),
    ("wrong_sender", tx(in_msg={"source": OTHER_RAW})),
    ("wrong_destination", tx(in_msg={"destination": OTHER_RAW})),
    ("no_hash", tx(hash=None)),
    ("no_in_msg", {"hash": "x", "mc_block_seqno": 1}),
])
def test_match_payment_rejects(name, t):
    assert match([t]) is None, name


def test_match_picks_valid_among_noise():
    assert match([tx(emulated=True), tx(in_msg={"source": OTHER_RAW}), tx(hash="GOOD")]).tx_hash == "GOOD"
