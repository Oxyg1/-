from __future__ import annotations

import asyncio
import logging

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import PRODUCTION, TEST
from aiogram.types import BotCommand, BotCommandScopeAllGroupChats, BotCommandScopeAllPrivateChats

from .bot_api_raw import RawBotApi
from .config import get_settings
from .handlers.router import Ctx, DuelDispatcher, RegisterMiddleware, build_router, install_widget_handler
from .services.duel_service import DuelService
from .services.leaderboard_service import LeaderboardService
from .stakes.stars import StarsStakeProvider
from .stakes.ton import TonStakeProvider
from .stakes.ton_client import ToncenterClient
from .storage.db import Database

log = logging.getLogger(__name__)

# widget_query / shared_widget_query — апдейты Bot API 10.4; в allowed_updates их надо указывать явно
ALLOWED_UPDATES = ["message", "callback_query", "pre_checkout_query", "widget_query", "shared_widget_query"]


async def run() -> None:
    s = get_settings()
    logging.getLogger().setLevel(s.log_level)
    session = AiohttpSession(api=TEST if s.use_test_server else PRODUCTION)
    bot = Bot(s.bot_token, session=session, default=DefaultBotProperties(parse_mode="HTML"))
    raw = RawBotApi(s.bot_token, s.api_base)
    db = await Database.connect(s.db_path)
    ton_client = ToncenterClient(s.ton_api_base, s.ton_api_key)
    try:
        me = await bot.get_me()
        leaderboard = LeaderboardService(raw, db)
        providers: dict = {}
        if s.enable_stars_stakes:
            providers["stars"] = StarsStakeProvider(bot, db, s)
        if s.enable_ton_stakes:
            providers["ton"] = TonStakeProvider(db, s, ton_client)
        service = DuelService(bot, raw, db, s, providers, leaderboard, bot_username=me.username or "")
        ctx = Ctx(raw, db, s, service, leaderboard, providers, me.username or "")

        dp = DuelDispatcher()
        for observer in (dp.message, dp.callback_query, dp.pre_checkout_query):
            observer.outer_middleware(RegisterMiddleware(db))
        dp.include_router(build_router(ctx))
        install_widget_handler(dp, ctx)

        eph = s.ephemeral_commands
        await bot.set_my_commands(
            [BotCommand(command="duel", description="Вызвать игрока на дуэль", is_ephemeral=eph),
             BotCommand(command="cancel", description="Отменить свой вызов", is_ephemeral=eph),
             BotCommand(command="stats", description="Моя статистика и рейтинг", is_ephemeral=eph),
             BotCommand(command="top", description="Табло дуэлянтов"),
             BotCommand(command="help", description="Правила")],
            scope=BotCommandScopeAllGroupChats())
        await bot.set_my_commands(
            [BotCommand(command="start", description="Начать"), BotCommand(command="help", description="Правила"),
             BotCommand(command="stats", description="Моя статистика и рейтинг"),
             BotCommand(command="top", description="Табло дуэлянтов"),
             BotCommand(command="cancel", description="Отменить свою дуэль"),
             BotCommand(command="terms", description="Условия"),
             BotCommand(command="paysupport", description="Поддержка по платежам")],
            scope=BotCommandScopeAllPrivateChats())

        await service.recover()
        bg = asyncio.create_task(service.run_background())
        log.info("duel bot @%s started (test server: %s)", me.username, s.use_test_server)
        try:
            await dp.start_polling(bot, allowed_updates=ALLOWED_UPDATES)
        finally:
            bg.cancel()
            await service.shutdown()
    finally:
        await ton_client.close()
        await raw.close()
        await db.close()
        await bot.session.close()
