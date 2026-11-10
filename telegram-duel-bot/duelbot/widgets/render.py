"""Загрузка HTML виджетов и проверка лимитов Telegram (32 KB, 4096 байт после zlib level 9)."""
from __future__ import annotations

import zlib
from functools import lru_cache
from importlib import resources

MAX_HTML_BYTES = 32768
MAX_COMPRESSED_BYTES = 4096


def compressed_size(html: str) -> int:
    """Сервер сжимает zlib с максимальным уровнем; Python считает так же (по документации)."""
    return len(zlib.compress(html.encode("utf-8"), 9))


def check_limits(html: str) -> None:
    raw = len(html.encode("utf-8"))
    if "\x00" in html:
        raise ValueError("NUL in widget html")
    if raw > MAX_HTML_BYTES:
        raise ValueError(f"widget html {raw} bytes > {MAX_HTML_BYTES}")
    comp = compressed_size(html)
    if comp > MAX_COMPRESSED_BYTES:
        raise ValueError(f"widget html compresses to {comp} bytes > {MAX_COMPRESSED_BYTES}")


@lru_cache
def load(name: str) -> str:
    html = resources.files("duelbot.widgets").joinpath(f"{name}.html").read_text(encoding="utf-8")
    check_limits(html)
    return html


def duel_html() -> str:
    return load("duel")


def leaderboard_html() -> str:
    return load("leaderboard")


def stats_html() -> str:
    return load("stats")
