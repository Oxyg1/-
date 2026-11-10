"""Хендлеры aiogram: команды, кнопки вызова, платежи, а также виджетные апдейты 10.4."""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from html import escape, unescape
from typing import Any

from aiogram import BaseMiddleware, Dispatcher, F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    PreCheckoutQuery,
    Update,
    User,
)

from .. import commands as C
from ..bot_api_raw import BotApiError, RawBotApi
from ..config import Settings
from ..services.duel_service import DuelService
from ..services.leaderboard_service import LeaderboardService
from ..stakes.base import NO_STAKE, StakeKind, StakeProvider, StakeSpec
from ..storage.db import Database, Player
from ..texts import HELP, PAYSUPPORT, TERMS, stats_text
from ..widgets.payloads import stats_card
from ..widgets.render import stats_html
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
            await message.answer("Ок! Сейчас пришлю виджет дуэли.")
            await service.resume_for_player(int(arg[5:]), message.from_user.id)
            return
        if arg == "lb":
            await send_leaderboard(message, message.chat.id)
            return
        if arg == "find":
            await cmd_find(message)
            return
        if arg == "stats":
            await cmd_stats(message, CommandObject(prefix="/", command=C.STATS, args=None))
            return
        await message.answer(HELP, parse_mode="HTML")

    @r.message(Command(C.HELP))
    @r.message(Command("help"), F.chat.type == "private")
    async def cmd_help(message: Message):
        await message.answer(HELP, parse_mode="HTML")

    @r.message(Command("terms"))
    async def cmd_terms(message: Message):
        await message.answer(TERMS, parse_mode="HTML")

    @r.message(Command("paysupport"))
    async def cmd_paysupport(message: Message):
        await message.answer(PAYSUPPORT, parse_mode="HTML")

    # ---------------- вызов ----------------
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

    async def send_challenge(chat_id: int, challenger: Player, target: Player, spec: StakeSpec) -> str:
        return await service.challenge(chat_id, challenger, target, spec)

    @r.message(Command(C.DUEL), F.chat.type.in_(GROUPS))
    async def cmd_duel(message: Message, command: CommandObject):
        try:
            spec = parse_stake(command.args)
        except StakeParseError as e:
            return await tell(message, str(e))
        target = await resolve_target(message, command.args)
        if target is None:
            return await tell(message, f"Не знаю такого игрока. Напиши <code>/{C.DUEL} @username</code> — соперник "
                                       "должен хоть раз написать боту или в этот чат — либо ответь командой "
                                       "на его сообщение.")
        challenger = await db.get_player(message.from_user.id)
        assert challenger is not None
        await tell(message, await send_challenge(message.chat.id, challenger, target, spec))

    @r.message(Command(C.DUEL), F.chat.type == "private")
    async def cmd_duel_private(message: Message, command: CommandObject):
        """Вызов из лички: приглашение уходит сопернику в его личку с ботом."""
        try:
            spec = parse_stake(command.args)
        except StakeParseError as e:
            return await message.answer(str(e))
        target = await resolve_target(message, command.args)
        if target is None:
            return await message.answer(
                f"Кого вызываем? Напиши <code>/{C.DUEL} @username</code> — соперник должен хоть раз написать "
                f"боту. Или найди случайного противника: /{C.FIND}", parse_mode="HTML")
        challenger = await db.get_player(message.from_user.id)
        assert challenger is not None
        await message.answer(await send_challenge(0, challenger, target, spec), parse_mode="HTML")

    # ---------------- поиск соперника ----------------
    @r.message(Command(C.FIND))
    async def cmd_find(message: Message):
        in_group = message.chat.type in GROUPS
        try:
            text = await service.find(message.from_user.id)
        except BotApiError as e:
            if not e.is_unreachable_user:
                log.exception("find failed")
                return await message.reply("Не получилось начать поиск, попробуй ещё раз.")
            await db.set_can_dm(message.from_user.id, False)
            kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                text="Открыть бота и нажать Start", url=f"https://t.me/{ctx.bot_username}?start=find")]])
            return await message.reply("Поиск идёт в личке с ботом — сначала нажми Start.", reply_markup=kb)
        if in_group:
            await tell(message, text)
        elif not text.startswith("🔎"):        # сам виджет поиска уже в чате; пишем только если что-то не так
            await message.answer(text)

    # ---------------- отмена ----------------
    @r.message(Command(C.CANCEL))
    async def cmd_cancel(message: Message):
        text = await service.withdraw(message.from_user.id)
        if message.chat.type in GROUPS:
            await tell(message, text)
        else:
            await message.answer(text)

    # ---------------- статистика ----------------
    @r.message(Command(C.STATS))
    async def cmd_stats(message: Message, command: CommandObject):
        """Карточка игрока — виджет в личке (обновляет цифры сама при каждом открытии)."""
        uid, in_group = message.from_user.id, message.chat.type in GROUPS
        asked = bool(command.args) or message.reply_to_message is not None
        who = await resolve_target(message, command.args) if asked else await db.get_player(uid)
        if who is None:
            unknown = "Не знаю такого игрока."
            return await (tell(message, unknown) if in_group else message.answer(unknown))
        rank = await db.rank_of(who.user_id)
        try:
            await raw.send_widget(uid, stats_html(), caption=f"🤠 {escape(who.display)}", parse_mode="HTML",
                                  chat_data=stats_card(who, rank), allow_queries=True, height=320)
        except BotApiError as e:
            if e.is_unreachable_user:
                await db.set_can_dm(uid, False)
                kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                    text="Открыть бота и нажать Start", url=f"https://t.me/{ctx.bot_username}?start=stats")]])
                return await message.reply("Карточка приходит в личку — сначала нажми Start у бота.", reply_markup=kb)
            log.warning("stats widget failed (%s), sending text", e)
            text = stats_text(who, rank)   # запасной вариант — текстом
            return await (tell(message, text) if in_group else message.answer(text, parse_mode="HTML"))
        if in_group:
            await tell(message, "Карточку отправил тебе в личку 🤠")

    @r.callback_query(F.data.startswith("d:"))
    async def on_duel_button(cb: CallbackQuery):
        try:
            _, action, sid = (cb.data or "").split(":")
            duel_id = int(sid)
        except ValueError:
            return await cb.answer()
        duel = await db.get_duel(duel_id)
        if duel is not None and action == "r":
            return await on_rematch(cb, duel)
        if duel is None or cb.from_user.id != duel.target_id:
            return await cb.answer("Это не ваш вызов.", show_alert=True)
        if action == "a":
            err = await service.accept(duel_id, cb.from_user.id)
            in_dm = not duel.chat_id
            ok_text = "Вызов принят! Дуэль — в виджете ниже." if in_dm else "Вызов принят! Дуэль — в личке с ботом."
            await cb.answer(err or ok_text, show_alert=bool(err))
            kb = None if (err or in_dm) else InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                text="Открыть бота", url=f"https://t.me/{ctx.bot_username}")]])
            await service.update_invite(duel, err or ("✅ " + ok_text), kb)
        else:
            ok = await service.decline(duel_id, cb.from_user.id)
            await cb.answer("Вы отказались." if ok else "Вызов уже недействителен.")

    async def on_rematch(cb: CallbackQuery, old) -> None:
        uid = cb.from_user.id
        if uid not in old.players:
            return await cb.answer("Реванш могут предложить только участники дуэли.", show_alert=True)
        me, opp = await db.get_player(uid), await db.get_player(old.opponent(uid))
        if me is None or opp is None:
            return await cb.answer("Игрок не найден.", show_alert=True)
        spec = NO_STAKE if old.stake_kind == "none" else StakeSpec(StakeKind(old.stake_kind), old.stake_amount)
        text = unescape(await send_challenge(old.chat_id, me, opp, spec))  # ответ на кнопку — без HTML
        ok = text.startswith("Вызов отправлен")
        await cb.answer(("🔁 " + text) if ok else text, show_alert=not ok)

    # ---------------- табло ----------------
    async def send_leaderboard(message: Message, target_chat: int) -> bool:
        uid = message.from_user.id
        try:
            await ctx.leaderboard.send_to(target_chat)
            return True
        except BotApiError as e:
            if e.is_unreachable_user:
                await db.set_can_dm(uid, False)
                kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                    text="Открыть бота и нажать Start", url=f"https://t.me/{ctx.bot_username}?start=lb")]])
                await message.reply("Сначала нажми Start у бота — табло приходит в личку.", reply_markup=kb)
                return False
            log.exception("leaderboard failed")
            await message.reply("Не получилось отправить табло.")
            return False

    @r.message(Command(C.TOP))
    async def cmd_leaderboard(message: Message):
        in_group = message.chat.type in GROUPS
        # В проде виджеты работают только в личных чатах (Bot API 10.4): из группы шлём в личку.
        to_group = in_group and ctx.settings.widgets_in_groups
        target_chat = message.chat.id if (to_group or not in_group) else message.from_user.id
        if await send_leaderboard(message, target_chat) and in_group and not to_group:
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
