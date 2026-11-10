import json

import pytest

from duelbot.engine.models import Outcome, Reason, RoundResult
from duelbot.handlers.parsing import StakeParseError, first_username, parse_stake
from duelbot.stakes.base import StakeKind
from duelbot.widgets.payloads import MAX_DATA_BYTES, duel_state, final_phase, leaderboard_public, trunc
from duelbot.widgets.render import (
    MAX_COMPRESSED_BYTES,
    check_limits,
    compressed_size,
    duel_html,
    leaderboard_html,
    stats_html,
)


def test_widget_html_within_telegram_limits():
    for html in (duel_html(), leaderboard_html(), stats_html()):
        assert len(html.encode()) <= 32768
        assert compressed_size(html) <= MAX_COMPRESSED_BYTES
        assert "<script src" not in html and "http://" not in html and "https://" not in html  # без внешних CDN
        assert "\x00" not in html


def test_check_limits_rejects_oversize():
    import os
    with pytest.raises(ValueError):
        check_limits("x" * 40000)
    # несжимаемый мусор укладывается в 32 КБ, но не в 4096 после zlib
    noise = os.urandom(6000).hex()
    with pytest.raises(ValueError):
        check_limits(noise)


def test_trunc_respects_utf8_bytes():
    s = trunc("Ковбой Джо Кровавый Лис", 14)
    assert len(s.encode()) <= 14 and s.endswith("…")
    assert trunc("abc", 10) == "abc"


def test_duel_state_within_1024_bytes_even_with_long_names():
    s = duel_state(1, "win", duel_id=99999, opponent="Я" * 500, stake_kind="ton", stake_label="123.456789",
                   ms=123.4, opp_ms=234.5, reason=Reason.FASTER, claim="o")
    assert len(s.encode()) <= MAX_DATA_BYTES
    d = json.loads(s)
    assert d["p"] == "win" and d["ms"] == 123 and d["k"] == "t" and d["q"] == "o"


def test_final_phase_mapping():
    win = RoundResult(Outcome.WIN, Reason.FASTER, 1, 2)
    assert final_phase(win, 1) == "win" and final_phase(win, 2) == "lose"
    fs = RoundResult(Outcome.WIN, Reason.FALSE_START, 1, 2)
    assert final_phase(fs, 2) == "fs"
    assert final_phase(RoundResult(Outcome.DRAW, Reason.TIE), 1) == "draw"
    assert final_phase(RoundResult(Outcome.CANCELLED, Reason.TIMEOUT), 1) == "cancel"


def test_leaderboard_public_fits_in_1024_with_worst_case_names():
    top = [("Очень Длинное Имя Игрока " * 3, 1000 - i, 999) for i in range(10)]
    last = [("Ковбой " * 10, "Шериф " * 10, 123.4) for _ in range(5)]
    s = leaderboard_public(1, top, last)
    assert len(s.encode()) <= MAX_DATA_BYTES
    d = json.loads(s)
    assert len(d["t"]) == 10            # топ-10 не режется
    assert len(d["l"]) <= 5


def test_leaderboard_public_small_keeps_everything():
    d = json.loads(leaderboard_public(1, [("Bob", 3, 1)], [("Bob", "Al", 201.6)]))
    assert d["t"] == [["Bob", 3, 1]] and d["l"] == [["Bob", "Al", 202]]


# ---------- ставки в команде ----------
def test_parse_stake_variants():
    assert parse_stake(None).kind is StakeKind.NONE
    assert parse_stake("@bob").kind is StakeKind.NONE
    s = parse_stake("@bob 50 stars")
    assert (s.kind, s.amount) == (StakeKind.STARS, 50)
    assert parse_stake("10⭐").amount == 10
    t = parse_stake("@bob 0.5 ton")
    assert (t.kind, t.amount, t.label) == (StakeKind.TON, 500_000_000, "0.5")
    assert parse_stake("1,25 ТОН").amount == 1_250_000_000


@pytest.mark.parametrize("bad", ["1.5 stars", "0 stars", "0.0000000001 ton"])
def test_parse_stake_errors(bad):
    with pytest.raises(StakeParseError):
        parse_stake(bad)


def test_first_username():
    assert first_username("@Cowboy_Joe 5 stars") == "Cowboy_Joe"
    assert first_username("no mention") is None
