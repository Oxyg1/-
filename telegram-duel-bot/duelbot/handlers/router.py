"""Хендлеры aiogram: команды, кнопки вызова, платежи, а также виджетные апдейты 10.4."""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from html import escape
from typing import Any

from aiogram import BaseMiddleware, Dispatcher, F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message, PreCheckoutQuery, Update, User,
)

from ..bot_api_raw import BotApiError, RawBotApi
from ..config import Settings
from ..engine.models import Reason
from ..stakes.base import StakeKind, StakeProvider
from ..storage.db import Database, Player
from ..services.duel_service import DuelService
from ..services.leaderboard_service import LeaderboardService
from ..texts import HELP, PAYSUPPORT, TERMS, challenge_text
from .parsing import StakeParseError, first_username, parse_stake

log = logging.getLogger(__name__)
GROUPS = {"group", "supergroup"}


@dataclass
class Ctx:
    raw: RawBotApi
    db: Database
    settings: Settings
    service: DuelService
    leaderboard: LeaderboardService
    providers: dict[str, StakeProvider]
    bot_username: str


class RegisterMiddleware(BaseMiddleware):
    """Запоминает всех, кого бот увидел: нужно, чтобы по @username найти user_id соперника."""

    def __init__(self, db: Database):
        self.db = db

    async def __call__(self, handler, event, data):
        user: User | None = getattr(event, "from_user", None)
        if user and not user.is_bot:
            private = isinstance(event, Message) and event.chat.type == "private"
            await self.db.upsert_player(user.id, user.username, user.full_name, True if private else None)
        return await handler(event, data)


class DuelDispatcher(Dispatcher):
    """aiogram 3.31 знает Bot API 10.3 и отбрасывает widget_query / shared_widget_query как неизвестные
    апдейты. Перехватываем их до обычной маршрутизации. Время получения фиксируем сразу: это и есть
    «время нажатия» для судьи."""

    widget_handler = None

    async def _listen_update(self, update: Update, **kwargs: Any) -> Any:
        t_recv = time.monotonic()
        extra = update.model_extra or {}
        if ("widget_query" in extra or "shared_widget_query" in extra) and self.widget_handler:
            await self.widget_handler(extra, t_recv)
            return None
        return await super()._listen_update(update, **kwargs)


def build_router(ctx: Ctx) -> Router:
    r = Router()
    db, raw, service = ctx.db, ctx.raw, ctx.service

    async def tell(message: Message, text: str) -> None:
        """Ответ автору команды, который больше никто не видит (эфемерно), с запасным обычным ответом."""
        try:
            await raw.send_ephemeral(text, chat_id=message.chat.id, receiver_user_id=message.from_user.id,
                                     reply_ephemeral_message_id=getattr(message, "ephemeral_message_id", None))
        except BotApiError as e:
            log.info("ephemeral reply failed (%s), falling back to a normal reply", e)
            await message.reply(text, parse_mode="HTML")

    # ---------------- служебные команды ----------------
    @r.message(Command("start"), F.chat.type == "private")
    async def cmd_start(message: Message, command: CommandObject):
        arg = (command.args or "").strip()
        if arg.startswith("duel_") and arg[5:].isdigit():
            await service.resume_for_player(int(arg[5:]), message.from_user.id)
            await message.answer("Ок! Сейчас пришлю виджет дуэли.")
            return
        await message.answer(HELP, parse_mode="HTML")

    @r.message(Command("help"))
    async def cmd_help(message: Message):
        await message.answer(HELP, parse_mode="HTML")

    @r.message(Command("terms"))
    async def cmd_terms(message: Message):
        await message.answer(TERMS, parse_mode="HTML")

    @r.message(Command("paysupport"))
    async def cmd_paysupport(message: Message):
        await message.answer(PAYSUPPORT, parse_mode="HTML")

    # ---------------- /duel ----------------
    async def resolve_target(message: Message, args: str | None) -> Player | None:
        for ent in message.entities or []:
            if ent.type == "text_mention" and ent.user and not ent.user.is_bot:
                u = ent.user
                await db.upsert_player(u.id, u.username, u.full_name)
                return await db.get_player(u.id)
        username = first_username(args)
        if username:
            return await db.find_player_by_username(username)
        if message.reply_to_message and message.reply_to_message.from_user:
            u = message.reply_to_message.from_user
            if not u.is_bot:
                await db.upsert_player(u.id, u.username, u.full_name)
                return await db.get_player(u.id)
        return None

    @r.message(Command("duel"), F.chat.type.in_(GROUPS))
    async def cmd_duel(message: Message, command: CommandObject):
        me = message.from_user
        try:
            spec = parse_stake(command.args)
        except StakeParseError as e:
            return await tell(message, str(e))
        target = await resolve_target(message, command.args)
        if target is None:
            return await tell(message, "Не знаю такого игрока. Напиши <code>/duel @username</code> — соперник "
                                       "должен хоть раз написать боту или в этот чат — либо ответь командой "
                                       "на его сообщение.")
        if target.user_id == me.id:
            return await tell(message, "Дуэль с самим собой — это уже не дуэль 🙂")
        challenger = await db.get_player(me.id)
        assert challenger is not None
        provider = None
        if not spec.is_none:
            provider = ctx.providers.get(spec.kind.value)
            if provider is None:
                return await tell(message, "Ставки такого типа выключены.")
            err = provider.validate(spec, challenger, target)
            if err:
                return await tell(message, err)
        for p in (challenger, target):
            if await db.active_duel_for(p.user_id):
                return await tell(message, f"{escape(p.display)} уже участвует в дуэли.")
        duel = await service.create_duel(message.chat.id, me.id, target.user_id, spec.kind.value, spec.amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="🤠 Принять", callback_data=f"d:a:{duel.id}"),
            InlineKeyboardButton(text="Отказаться", callback_data=f"d:d:{duel.id}"),
        ]])
        try:
            sent = await raw.send_ephemeral(
                challenge_text(challenger, duel, ctx.settings.challenge_ttl // 60),
                chat_id=message.chat.id, receiver_user_id=target.user_id,
                reply_markup=kb.model_dump(exclude_none=True))
        except BotApiError as e:
            log.warning("ephemeral challenge failed: %s", e)
            await service.cancel_duel(duel.id, Reason.ABORTED)
            return await tell(message, "Не получилось отправить вызов приватно. Сделайте бота администратором "
                                       "группы: только так он может писать эфемерные сообщения любому участнику.")
        await db.update_duel(duel.id, ephemeral_id=sent.get("ephemeral_message_id"))
        await tell(message, f"Вызов отправлен {escape(target.display)} (ставка: "
                            f"{'на интерес' if spec.is_none else spec.label + (' ⭐' if spec.kind is StakeKind.STARS else ' TON')}). "
                            f"Ждём {ctx.settings.challenge_ttl // 60} мин.")

    @r.callback_query(F.data.startswith("d:"))
    async def on_duel_button(cb: CallbackQuery):
        try:
            _, action, sid = (cb.data or "").split(":")
            duel_id = int(sid)
        except ValueError:
            return await cb.answer()
        duel = await db.get_duel(duel_id)
        if duel is None or cb.from_user.id != duel.target_id:
            return await cb.answer("Это не ваш вызов.", show_alert=True)
        if action == "a":
            err = await service.accept(duel_id, cb.from_user.id)
            await cb.answer(err or "Вызов принят! Дуэль — в личке с ботом.", show_alert=bool(err))
            text = err or "✅ Вызов принят. Дуэль ждёт в личке с ботом."
            kb = None if err else InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                text="Открыть бота", url=f"https://t.me/{ctx.bot_username}")]])
        else:
            ok = await service.decline(duel_id, cb.from_user.id)
            await cb.answer("Вы отказались." if ok else "Вызов уже недействителен.")
            return  # service.decline сам обновит эфемерное сообщение
        if duel.ephemeral_id:
            try:
                await raw.edit_ephemeral_text(duel.chat_id, duel.target_id, duel.ephemeral_id, text,
                                              reply_markup=kb.model_dump(exclude_none=True) if kb else None)
            except BotApiError:
                pass

    # ---------------- /leaderboard ----------------
    @r.message(Command("leaderboard"))
    async def cmd_leaderboard(message: Message):
        uid = message.from_user.id
        in_group = message.chat.type in GROUPS
        # В проде виджеты работают только в личных чатах (Bot API 10.4): из группы шлём в личку.
        to_group = in_group and ctx.settings.widgets_in_groups
        target_chat = message.chat.id if (to_group or not in_group) else uid
        try:
            await ctx.leaderboard.send_to(target_chat)
        except BotApiError as e:
            if e.is_unreachable_user:
                await db.set_can_dm(uid, False)
                kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                    text="Открыть бота и нажать Start", url=f"https://t.me/{ctx.bot_username}?start=lb")]])
                return await message.reply("Сначала нажми Start у бота — табло приходит в личку.", reply_markup=kb)
            log.exception("leaderboard failed")
            return await message.reply("Не получилось отправить табло.")
        if in_group and not to_group:
            await message.reply("Табло отправил тебе в личку 🤠")

    # ---------------- платежи Stars ----------------
    @r.pre_checkout_query()
    async def on_pre_checkout(q: PreCheckoutQuery):
        stars = ctx.providers.get("stars")
        err = "Ставки в Stars выключены." if stars is None else await stars.check_pre_checkout(  # type: ignore[attr-defined]
            q.from_user.id, q.currency, q.total_amount, q.invoice_payload)
        await q.answer(ok=err is None, error_message=err)

    @r.message(F.successful_payment)
    async def on_paid(message: Message):
        sp = message.successful_payment
        stars = ctx.providers.get("stars")
        if stars is None or sp is None:
            return
        duel = await stars.on_successful_payment(  # type: ignore[attr-defined]
            message.from_user.id, sp.total_amount, sp.invoice_payload, sp.telegram_payment_charge_id)
        if duel:
            await message.answer("⭐ Ставка принята! Ждём соперника.")
            await service.on_funded(duel.id)

    return r


def install_widget_handler(dp: DuelDispatcher, ctx: Ctx) -> None:
    async def handle(extra: dict, t_recv: float) -> None:
        if wq := extra.get("widget_query"):
            data = None
            try:
                data = await ctx.service.on_widget_query(wq, t_recv)
            except Exception:  # noqa: BLE001
                log.exception("widget_query failed")
                data = json.dumps({"e": "bad"}, separators=(",", ":"))
            finally:
                try:
                    await ctx.raw.answer_widget_query(wq["id"], data)
                except BotApiError as e:
                    log.warning("answerWidgetQuery failed: %s", e)
        elif sq := extra.get("shared_widget_query"):
            try:
                await ctx.raw.answer_widget_query(sq["id"], None)
            except BotApiError as e:
                log.warning("answerWidgetQuery (shared) failed: %s", e)

    dp.widget_handler = handle
