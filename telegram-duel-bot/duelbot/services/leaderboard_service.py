"""Общий виджет «Табло дуэлянтов» (shared widget): создаём один раз, потом правим editSharedWidgetData."""
from __future__ import annotations

import asyncio
import logging
import time

from ..bot_api_raw import BotApiError, RawBotApi
from ..engine.rating import leaderboard_sort
from ..storage.db import Database
from ..widgets.payloads import leaderboard_public
from ..widgets.render import leaderboard_html

log = logging.getLogger(__name__)
KV_KEY = "leaderboard_widget_id"
MIN_EDIT_INTERVAL = 1.1  # документация: shared widget — не чаще 1 правки в секунду


class LeaderboardService:
    def __init__(self, raw: RawBotApi, db: Database):
        self.raw, self.db = raw, db
        self._dirty = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._last_edit = 0.0

    async def build_public(self) -> str:
        stats = leaderboard_sort(await self.db.all_stats(), limit=10)
        names = await self.db.names_for([s.user_id for s in stats])
        top = [(names.get(s.user_id, str(s.user_id)), s.wins, s.losses) for s in stats]
        last = [(d["winner"], d["loser"], d["ms"]) for d in await self.db.last_duels(5)]
        return leaderboard_public(int(time.time() * 1000), top, last)

    async def widget_id(self) -> str | None:
        return await self.db.kv_get(KV_KEY)

    async def send_to(self, chat_id: int) -> dict:
        """Отправляет табло в чат. Первый вызов создаёт shared widget (sendWidget is_shared=true)
        и запоминает его id; дальше — sendSharedWidget."""
        wid = await self.widget_id()
        caption = "🤠 Табло дуэлянтов"
        if wid:
            try:
                return await self.raw.send_shared_widget(chat_id, wid, caption=caption)
            except BotApiError as e:
                if e.is_unreachable_user:
                    raise
                log.warning("sendSharedWidget failed (%s), recreating widget", e)
        msg = await self.raw.send_widget(
            chat_id, leaderboard_html(), caption=caption, public_data=await self.build_public(),
            allow_queries=False, is_shared=True,
        )
        new_id = (msg.get("widget") or {}).get("id")
        if new_id:
            await self.db.kv_set(KV_KEY, new_id)
        else:
            log.error("sendWidget did not return widget.id: %s", msg)
        return msg

    # ---- обновление с троттлингом ----
    def request_refresh(self) -> None:
        self._dirty.set()
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        while self._dirty.is_set():
            self._dirty.clear()
            wid = await self.widget_id()
            if not wid:
                return
            wait = self._last_edit + MIN_EDIT_INTERVAL - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                await self.raw.edit_shared_widget_data(wid, await self.build_public(), cache_time=10)
            except BotApiError as e:
                log.warning("editSharedWidgetData failed: %s", e)
                if e.retry_after:
                    await asyncio.sleep(e.retry_after)
                    self._dirty.set()
            self._last_edit = time.monotonic()
