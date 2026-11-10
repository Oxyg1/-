"""Сборка и проверка chat_data / public_data виджетов (лимит Telegram: 1024 байта UTF-8)."""
from __future__ import annotations

import json
from typing import Any

from ..engine.models import Outcome, Reason, RoundResult

MAX_DATA_BYTES = 1024

# код причины для виджета (см. словарь R в duel.html)
REASON_CODE = {
    Reason.FASTER: "f", Reason.FALSE_START: "fs", Reason.TOO_FAST: "tf", Reason.OPPONENT_TIMEOUT: "ot",
    Reason.TIE: "tie", Reason.BOTH_FALSE_START: "bfs", Reason.NO_RESPONSE: "nr",
    Reason.ONE_SIDED_TIMEOUT: "os", Reason.TIMEOUT: "to", Reason.DECLINED: "dc", Reason.ABORTED: "ab",
}


def dumps(obj: Any) -> str:
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    if len(s.encode("utf-8")) > MAX_DATA_BYTES:
        raise ValueError(f"widget data is {len(s.encode('utf-8'))} bytes (> {MAX_DATA_BYTES})")
    return s


def trunc(text: str, max_bytes: int) -> str:
    """Обрезает по границе символа, чтобы уложиться в max_bytes UTF-8."""
    text = " ".join(text.split())
    if len(text.encode("utf-8")) <= max_bytes:
        return text
    out = ""
    for ch in text:
        if len((out + ch + "…").encode("utf-8")) > max_bytes:
            break
        out += ch
    return out + "…"


def duel_state(rev: int, phase: str, *, duel_id: int | None = None, opponent: str | None = None,
               stake_kind: str | None = None, stake_label: str | None = None, nonce: int | None = None,
               ms: float | None = None, opp_ms: float | None = None, reason: Reason | None = None,
               claim: str | None = None, error: str | None = None) -> str:
    """phase: stake | lobby | wait | go | win | lose | fs | draw | cancel."""
    d: dict[str, Any] = {"r": rev, "p": phase}
    if duel_id is not None:
        d["d"] = duel_id
    if opponent:
        d["o"] = trunc(opponent, 40)
    if stake_kind:
        d["k"] = {"stars": "s", "ton": "t"}.get(stake_kind, "")
        d["a"] = stake_label
    if nonce is not None:
        d["n"] = nonce
    if ms is not None:
        d["ms"] = round(ms)
    if opp_ms is not None:
        d["oms"] = round(opp_ms)
    if reason is not None:
        d["w"] = REASON_CODE.get(reason, "")
    if claim:
        d["q"] = claim          # o: плательщик должен оплатить, w: ждём оплату, p: оплачено, u: не оплачено
        d.setdefault("a", stake_label)
    if error:
        d["e"] = error
    return dumps(d)


def final_phase(result: RoundResult, uid: int) -> str:
    if result.outcome is Outcome.CANCELLED:
        return "cancel"
    if result.outcome is Outcome.DRAW:
        return "draw"
    if result.winner_id == uid:
        return "win"
    return "fs" if result.reason in (Reason.FALSE_START, Reason.TOO_FAST) else "lose"


def leaderboard_public(rev: int, top: list[tuple[str, int, int]], last: list[tuple[str, str, float | None]],
                       name_bytes: int = 14) -> str:
    """Топ-10 и последние дуэли в ≤1024 байт. При нехватке места сначала режем последние дуэли,
    потом укорачиваем имена. Топ-10 не сокращается."""
    top = top[:10]
    last = list(last[:5])
    for nb in (name_bytes, 10, 8, 6):
        n_last = len(last)
        while True:
            payload = {
                "r": rev,
                "t": [[trunc(n, nb), w, l] for n, w, l in top],
                "l": [[trunc(a, nb), trunc(b, nb), None if ms is None else round(ms)] for a, b, ms in last[:n_last]],
            }
            s = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            if len(s.encode("utf-8")) <= MAX_DATA_BYTES:
                return s
            if n_last == 0:
                break
            n_last -= 1
    raise ValueError("leaderboard does not fit into 1024 bytes")
