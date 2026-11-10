"""Клиент toncenter API v3 (индексатор). Нужен только метод GET /transactions."""
from __future__ import annotations

import asyncio
import logging
import time

import aiohttp

log = logging.getLogger(__name__)


class ToncenterClient:
    """Без API-ключа лимит — 1 запрос в секунду (по документации), поэтому есть простой троттлинг."""

    def __init__(self, base: str, api_key: str = "", session: aiohttp.ClientSession | None = None,
                 min_interval: float | None = None):
        self.base = base.rstrip("/")
        self.api_key = api_key
        self._session = session
        self._own = session is None
        self._interval = min_interval if min_interval is not None else (0.2 if api_key else 1.1)
        self._last = 0.0
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        if self._own and self._session is not None:
            await self._session.close()

    async def account_transactions(self, account: str, start_utime: int, limit: int = 50) -> list[dict]:
        async with self._lock:
            wait = self._last + self._interval - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = time.monotonic()
        if self._session is None:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20))
        headers = {"X-API-Key": self.api_key} if self.api_key else {}
        params = {"account": account, "start_utime": str(start_utime), "limit": str(limit), "sort": "desc"}
        async with self._session.get(f"{self.base}/transactions", params=params, headers=headers) as resp:
            resp.raise_for_status()
            data = await resp.json()
        return data.get("transactions", [])
