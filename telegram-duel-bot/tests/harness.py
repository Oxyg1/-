"""Тестовый стенд: фейковый Telegram + «виджеты» игроков с управляемой задержкой сети и реакцией."""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field

from duelbot.bot_api_raw import BotApiError
from duelbot.config import Settings
from duelbot.services import duel_service
from duelbot.services.duel_service import DuelService
from duelbot.stakes.base import StakeProvider


class FakeBot:
    def __init__(self):
        self.messages: list[tuple[int, str]] = []
        self.markups: list[object] = []
        self.invoices: list[dict] = []
        self.refunds: list[tuple[int, str]] = []
        self.gifts: list[dict] = []
        self.fail_refund_for: set[str] = set()

    async def send_message(self, chat_id, text, **kw):
        self.messages.append((chat_id, text))
        self.markups.append(kw.get("reply_markup"))

    async def send_invoice(self, **kw):
        self.invoices.append(kw)

    async def refund_star_payment(self, user_id, telegram_payment_charge_id):
        if telegram_payment_charge_id in self.fail_refund_for:
            raise RuntimeError("refund failed")
        self.refunds.append((user_id, telegram_payment_charge_id))
        return True

    async def send_gift(self, **kw):
        self.gifts.append(kw)
        return True


@dataclass
class Player:
    uid: int
    react_ms: float | None = 200.0     # None — не нажимает
    one_way_ms: float = 10.0           # задержка сети в одну сторону
    press_early_ms: float | None = None  # нажать через столько мс после «Приготовься…»
    msg_id: int | None = None
    states: list[dict] = field(default_factory=list)


class FakeRaw:
    """Заменяет RawBotApi. Каждый edit_message_widget_data «доставляется» в виджет игрока и запускает его поведение."""

    def __init__(self, harness: Harness):
        self.h = harness
        self.answers: list[tuple[str, str | None]] = []
        self.shared_edits: list[tuple[str, str]] = []
        self.ephemeral_edits: list[str] = []
        self.unreachable: set[int] = set()

    async def send_widget(self, chat_id, html, **kw):
        if chat_id in self.unreachable:
            raise BotApiError("sendWidget", 403, "Forbidden: bot can't initiate conversation with a user")
        p = self.h.players[chat_id]
        p.msg_id = 1000 + chat_id
        state = json.loads(kw["chat_data"])
        p.states.append(state)
        return {"message_id": p.msg_id, "widget": {"id": "w1"}}

    async def edit_message_widget_data(self, *, chat_id=None, message_id=None, chat_data=None, **kw):
        p = self.h.players[chat_id]
        state = json.loads(chat_data)
        asyncio.create_task(self._deliver(p, state))
        return True

    async def _deliver(self, p: Player, state: dict):
        await asyncio.sleep(p.one_way_ms / 1000)         # сервер → клиент
        p.states.append(state)
        ph = state["p"]
        if ph == "lobby" and "n" in state:
            await self._query(p, f"ack:{state['n']}")    # виджет отвечает сразу (фоновый запрос)
        elif ph == "wait" and p.press_early_ms is not None:
            await asyncio.sleep(p.press_early_ms / 1000)
            await self._query(p, "p")
        elif ph == "go" and p.react_ms is not None:
            await asyncio.sleep(p.react_ms / 1000)
            await self._query(p, "p")

    async def _query(self, p: Player, data: str, qtype=None):
        await asyncio.sleep(p.one_way_ms / 1000)         # клиент → сервер
        wq = {"id": f"q{time.monotonic()}", "from": {"id": p.uid}, "chat": {"id": p.uid, "type": "private"},
              "message_id": p.msg_id, "data": data}
        if qtype:
            wq["type"] = qtype
        return await self.h.service.on_widget_query(wq, time.monotonic())

    async def answer_widget_query(self, qid, data=None):
        self.answers.append((qid, data))
        return True

    async def edit_shared_widget_data(self, wid, data, cache_time=None):
        self.shared_edits.append((wid, data))
        return True

    async def edit_ephemeral_text(self, *a, **kw):
        self.ephemeral_edits.append(a[-1] if a else "")
        return True


class FakeLeaderboard:
    def __init__(self):
        self.refreshes = 0

    def request_refresh(self):
        self.refreshes += 1


class Harness:
    def __init__(self, db, monkeypatch, providers_factory=None, **settings):
        monkeypatch.setattr(duel_service, "BG_REQUEST_GAP", 0.0)
        monkeypatch.setattr(duel_service, "ACK_TIMEOUT", 0.5)
        cfg = dict(bot_token="x", delay_min=0.05, delay_max=0.1, response_timeout=0.6, default_rtt_ms=50.0,
                   max_rtt_ms=400.0, min_human_ms=80.0, tie_ms=20.0, ping_samples=1)
        cfg.update(settings)
        self.settings = Settings(_env_file=None, **cfg)
        self.db = db
        self.bot = FakeBot()
        self.raw = FakeRaw(self)
        self.players: dict[int, Player] = {}
        self.leaderboard = FakeLeaderboard()
        self.providers: dict[str, StakeProvider] = providers_factory(self) if providers_factory else {}
        self.service = DuelService(self.bot, self.raw, db, self.settings, self.providers, self.leaderboard,
                                   bot_username="duelbot")

    async def add_players(self, a: Player, b: Player):
        self.players = {a.uid: a, b.uid: b}
        await self.db.upsert_player(a.uid, f"p{a.uid}", f"P{a.uid}", True)
        await self.db.upsert_player(b.uid, f"p{b.uid}", f"P{b.uid}", True)

    async def new_duel(self, challenger: int, target: int, kind="none", amount=0):
        return await self.service.create_duel(-100, challenger, target, kind, amount)

    async def hi(self, uid: int):
        p = self.players[uid]
        await self.raw._query(p, "hi")

    async def wait_done(self, duel_id: int, timeout=5.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            d = await self.db.get_duel(duel_id)
            if d.status.value in ("finished", "cancelled"):
                await asyncio.sleep(0.15)   # дать дойти расчёту ставок и финальным пушам
                return await self.db.get_duel(duel_id)
            await asyncio.sleep(0.02)
        raise AssertionError("duel did not finish")

    def phases(self, uid: int) -> list[str]:
        return [s["p"] for s in self.players[uid].states]
