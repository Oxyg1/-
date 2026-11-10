"""Тонкая обёртка над сырым Bot API для методов 10.4, которых ещё нет в aiogram (3.31 = API 10.3).

Сигнатуры взяты из https://core.telegram.org/bots/api (Bot API 10.4):
  sendWidget, sendSharedWidget, answerWidgetQuery, editMessageWidgetData, editSharedWidgetData
Эфемерные методы (editEphemeralMessageText и др.) в aiogram есть, но с ограничениями
10.3 (receiver_user_id обязателен), поэтому для них тоже можно пользоваться call().
"""
from __future__ import annotations

import json
import logging
from typing import Any

import aiohttp

log = logging.getLogger(__name__)


class BotApiError(Exception):
    def __init__(self, method: str, code: int, description: str, parameters: dict | None = None):
        super().__init__(f"{method}: [{code}] {description}")
        self.method = method
        self.code = code
        self.description = description
        self.parameters = parameters or {}

    @property
    def retry_after(self) -> int | None:
        return self.parameters.get("retry_after")

    @property
    def is_unreachable_user(self) -> bool:
        """Пользователь не нажимал Start / заблокировал бота."""
        d = self.description.lower()
        return self.code == 403 or "can't initiate conversation" in d or "bot was blocked" in d

    @property
    def is_not_modified(self) -> bool:
        return "message is not modified" in self.description.lower()


class RawBotApi:
    def __init__(self, token: str, base: str = "https://api.telegram.org/bot{token}/{method}",
                 session: aiohttp.ClientSession | None = None):
        self._token = token
        self._base = base
        self._session = session
        self._own_session = session is None

    async def _sess(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        return self._session

    async def close(self) -> None:
        if self._own_session and self._session is not None:
            await self._session.close()

    async def call(self, method: str, **params: Any) -> Any:
        """POST JSON. None-значения выбрасываются: Bot API считает их отсутствующими."""
        payload = {k: v for k, v in params.items() if v is not None}
        url = self._base.format(token=self._token, method=method)
        session = await self._sess()
        async with session.post(url, json=payload) as resp:
            try:
                data = await resp.json(content_type=None)
            except (aiohttp.ContentTypeError, json.JSONDecodeError):
                raise BotApiError(method, resp.status, "non-JSON response") from None
        if not data.get("ok"):
            raise BotApiError(method, data.get("error_code", resp.status),
                              data.get("description", ""), data.get("parameters"))
        return data["result"]

    # ---- виджеты (Bot API 10.4) ----
    async def send_widget(
        self, chat_id: int | str, html: str, *, caption: str | None = None, parse_mode: str | None = None,
        width: int | None = None, height: int | None = None,
        public_data: str | None = None, chat_data: str | None = None,
        allow_queries: bool | None = None, is_shared: bool | None = None,
        show_caption_above_media: bool | None = None, disable_notification: bool | None = None,
        protect_content: bool | None = None, reply_markup: dict | None = None,
    ) -> dict:
        return await self.call(
            "sendWidget", chat_id=chat_id, html=html, caption=caption, parse_mode=parse_mode,
            width=width, height=height, public_data=public_data, chat_data=chat_data,
            allow_queries=allow_queries, is_shared=is_shared,
            show_caption_above_media=show_caption_above_media,
            disable_notification=disable_notification, protect_content=protect_content,
            reply_markup=reply_markup,
        )

    async def send_shared_widget(
        self, chat_id: int | str, widget_id: str, *, chat_data: str | None = None,
        caption: str | None = None, parse_mode: str | None = None,
        disable_notification: bool | None = None, protect_content: bool | None = None,
    ) -> dict:
        return await self.call(
            "sendSharedWidget", chat_id=chat_id, widget_id=widget_id, chat_data=chat_data,
            caption=caption, parse_mode=parse_mode,
            disable_notification=disable_notification, protect_content=protect_content,
        )

    async def answer_widget_query(self, widget_query_id: str, data: str | None = None) -> bool:
        return await self.call("answerWidgetQuery", widget_query_id=widget_query_id, data=data)

    async def edit_message_widget_data(
        self, *, chat_id: int | str | None = None, message_id: int | None = None,
        inline_message_id: str | None = None,
        public_data: str | None = None, chat_data: str | None = None,
    ) -> bool:
        """Не переданное поле не меняется; пустая строка очищает."""
        try:
            return await self.call(
                "editMessageWidgetData", chat_id=chat_id, message_id=message_id,
                inline_message_id=inline_message_id, public_data=public_data, chat_data=chat_data,
            )
        except BotApiError as e:
            if e.is_not_modified:   # документация: считать выполненным
                return True
            raise

    async def edit_shared_widget_data(self, widget_id: str, public_data: str,
                                      cache_time: int | None = None) -> bool:
        try:
            return await self.call("editSharedWidgetData", widget_id=widget_id,
                                   public_data=public_data, cache_time=cache_time)
        except BotApiError as e:
            if e.is_not_modified:
                return True
            raise

    # ---- эфемерные сообщения ----
    async def send_ephemeral(
        self, text: str, *, receiver_user_id: int | None = None, chat_id: int | str | None = None,
        callback_query_id: str | None = None, reply_ephemeral_message_id: int | None = None,
        reply_markup: dict | None = None, parse_mode: str | None = "HTML",
    ) -> dict:
        eph: dict[str, Any] = {}
        if receiver_user_id is not None:
            eph["receiver_user_id"] = receiver_user_id
        if callback_query_id is not None:
            eph["callback_query_id"] = callback_query_id
        reply = {"ephemeral_message_id": reply_ephemeral_message_id} if reply_ephemeral_message_id else None
        return await self.call(
            "sendMessage", chat_id=chat_id, text=text, parse_mode=parse_mode,
            ephemeral_message_parameters=eph, reply_parameters=reply, reply_markup=reply_markup,
        )

    async def edit_ephemeral_text(self, chat_id: int | str, receiver_user_id: int, ephemeral_message_id: int,
                                  text: str, *, reply_markup: dict | None = None,
                                  parse_mode: str | None = "HTML") -> bool:
        return await self.call(
            "editEphemeralMessageText", chat_id=chat_id, receiver_user_id=receiver_user_id,
            ephemeral_message_id=ephemeral_message_id, text=text, parse_mode=parse_mode,
            reply_markup=reply_markup,
        )
