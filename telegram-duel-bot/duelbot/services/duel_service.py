"""Оркестрация дуэли: вызов → (ставка) → лобби → пинг → раунд → итог. Вся логика Telegram здесь,
решения о победителе принимает чистый движок (duelbot.engine)."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field, replace
from html import escape, unescape

from aiogram import Bot
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .. import commands as C
from ..bot_api_raw import BotApiError, RawBotApi
from ..config import Settings
from ..engine.judge import evaluate
from ..engine.models import Outcome, PlayerState, Reason, RoundResult
from ..engine.states import Status
from ..engine.timing import estimate_rtt, random_delay
from ..stakes.base import NO_STAKE, NoStakeProvider, StakeError, StakeKind, StakeProvider, StakeSpec
from ..stakes.ton_utils import format_ton
from ..storage.db import Database, Duel, Player
from ..texts import challenge_text, result_text, stake_amount_label, stake_label
from ..widgets.payloads import duel_state, final_phase, stats_card, trunc
from ..widgets.render import duel_html
from .leaderboard_service import LeaderboardService

log = logging.getLogger(__name__)

PRE_ROUND = (Status.CHALLENGED, Status.STAKING, Status.LOBBY)  # до раунда дуэль ещё можно отменить

ACK_TIMEOUT = 4.0
BG_REQUEST_GAP = 5.3   # документация: фоновые запросы виджета — не чаще раза в 5 секунд
ROUND_HARD_CAP = 90    # потолок жизни статуса ROUND на случай зависания


@dataclass
class AckWait:
    nonce: int
    sent_at: float
    event: asyncio.Event = field(default_factory=asyncio.Event)
    rtt: float | None = None


@dataclass
class Runtime:
    duel_id: int
    players: tuple[int, int]
    states: dict[int, PlayerState]
    phase: str = "ping"            # ping | wait | go | done
    rtt: dict[int, float] = field(default_factory=dict)
    last_bg: dict[int, float] = field(default_factory=dict)
    acks: dict[int, AckWait] = field(default_factory=dict)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None


class DuelService:
    def __init__(self, bot: Bot, raw: RawBotApi, db: Database, settings: Settings,
                 providers: dict[str, StakeProvider], leaderboard: LeaderboardService,
                 bot_username: str = "", rng: random.Random | None = None):
        self.bot, self.raw, self.db, self.s = bot, raw, db, settings
        self.providers = providers
        self.leaderboard = leaderboard
        self.bot_username = bot_username
        self.rng = rng or random.SystemRandom()
        self.rt: dict[int, Runtime] = {}
        self._rev: dict[tuple[int, int], int] = {}
        self.last_state: dict[tuple[int, int], str] = {}
        self._bg_seen: dict[tuple[int, int], float] = {}
        self._start_lock = asyncio.Lock()
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ helpers
    def provider(self, duel: Duel) -> StakeProvider:
        return self.providers.get(duel.stake_kind) or NoStakeProvider()

    def _spawn(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    def _next_rev(self, duel_id: int, uid: int) -> int:
        key = (duel_id, uid)
        rev = max(self._rev.get(key, 0) + 1, int(time.time() * 1000))
        self._rev[key] = rev
        return rev

    async def _players(self, duel: Duel) -> dict:
        out = {}
        for uid in duel.players:
            out[uid] = await self.db.get_player(uid)
        return out

    async def _push(self, duel: Duel, uid: int, phase: str, **kw) -> bool:
        """Обновляет chat_data виджета игрока (сервер сам толкает изменение в открытый виджет)."""
        dp = await self.db.get_dp(duel.id, uid)
        if dp is None or dp.widget_message_id is None:
            return False
        opp = await self.db.get_player(duel.opponent(uid))
        stake = {}
        if duel.stake_kind != "none":
            stake = {"stake_kind": duel.stake_kind,
                     "stake_label": stake_amount_label(duel.stake_kind, duel.stake_amount)}
        data = duel_state(self._next_rev(duel.id, uid), phase, duel_id=duel.id,
                          opponent=opp.display if opp else None, **stake, **kw)
        self.last_state[(duel.id, uid)] = data
        for attempt in (1, 2):
            try:
                await self.raw.edit_message_widget_data(chat_id=uid, message_id=dp.widget_message_id,
                                                        chat_data=data)
                return True
            except BotApiError as e:
                if e.retry_after and attempt == 1:
                    await asyncio.sleep(min(e.retry_after, 5))
                    continue
                log.warning("editMessageWidgetData(%s) failed: %s", uid, e)
                return False
        return False

    async def _group(self, duel: Duel, text: str, markup=None) -> None:
        try:
            await self.bot.send_message(duel.chat_id, text, parse_mode="HTML", reply_markup=markup)
        except Exception:  # noqa: BLE001
            log.exception("failed to post to group %s", duel.chat_id)

    async def _dm(self, uid: int, text: str) -> None:
        try:
            await self.bot.send_message(uid, text, parse_mode="HTML")
        except Exception:  # noqa: BLE001
            log.info("cannot DM %s", uid)

    # ------------------------------------------------------------------ создание и принятие
    async def create_duel(self, chat_id: int, challenger_id: int, target_id: int, kind: str, amount: int) -> Duel:
        return await self.db.create_duel(chat_id, challenger_id, target_id, kind, amount, self.s.challenge_ttl)

    async def challenge(self, chat_id: int, challenger: Player, target: Player, spec: StakeSpec) -> str:
        """Создаёт дуэль и шлёт вызванному эфемерное приглашение. Возвращает текст для вызывающего."""
        if target.user_id == challenger.user_id:
            return "Дуэль с самим собой — это уже не дуэль 🙂"
        if not spec.is_none:
            provider = self.providers.get(spec.kind.value)
            if provider is None:
                return "Ставки такого типа выключены."
            if err := provider.validate(spec, challenger, target):
                return err
        for p in (challenger, target):
            if await self.db.active_duel_for(p.user_id):
                return f"{escape(p.display)} уже участвует в дуэли."
        if wait := await self.cooldown_left(challenger.user_id, target.user_id):
            return f"{escape(target.display)} недавно отказался. Повторный вызов — через {wait} с."
        duel = await self.create_duel(chat_id, challenger.user_id, target.user_id, spec.kind.value, spec.amount)
        kb = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="🤠 Принять", callback_data=f"d:a:{duel.id}"),
            InlineKeyboardButton(text="Отказаться", callback_data=f"d:d:{duel.id}"),
        ]])
        try:
            sent = await self.raw.send_ephemeral(
                challenge_text(challenger, duel, self.s.challenge_ttl // 60),
                chat_id=chat_id, receiver_user_id=target.user_id,
                reply_markup=kb.model_dump(exclude_none=True))
        except BotApiError as e:
            log.warning("ephemeral challenge failed: %s", e)
            await self.cancel_duel(duel.id, Reason.ABORTED)
            return ("Не получилось отправить вызов приватно. Сделайте бота администратором группы: "
                    "только так он может писать эфемерные сообщения любому участнику.")
        await self.db.update_duel(duel.id, ephemeral_id=sent.get("ephemeral_message_id"))
        return (f"Вызов отправлен {escape(target.display)} (ставка: {stake_label(duel)}). "
                f"Ждём {self.s.challenge_ttl // 60} мин. Передумал — /{C.CANCEL}.")

    async def cooldown_left(self, challenger_id: int, target_id: int) -> int:
        """Сколько секунд ещё нельзя вызывать игрока, который недавно отказал этому же вызывающему."""
        last = await self.db.last_duel_between(challenger_id, target_id)
        if last is None or last.reason != Reason.DECLINED.value or not last.finished_at:
            return 0
        return max(0, int(last.finished_at + self.s.challenge_cooldown - time.time() + 0.999))

    async def withdraw(self, user_id: int) -> str:
        """/ccancel: участник отменяет свою дуэль, пока раунд не начался."""
        duel = await self.db.active_duel_for(user_id)
        if duel is None:
            return "У тебя нет активных вызовов."
        if duel.status not in PRE_ROUND:
            return "Раунд уже идёт — отменить нельзя."
        await self.cancel_duel(duel.id, Reason.WITHDRAWN, by=user_id)
        return f"Дуэль №{duel.id} отменена."

    async def decline(self, duel_id: int, user_id: int) -> bool:
        duel = await self.db.get_duel(duel_id)
        if not duel or duel.status is not Status.CHALLENGED or user_id != duel.target_id:
            return False
        await self.cancel_duel(duel_id, Reason.DECLINED)
        return True

    async def accept(self, duel_id: int, user_id: int) -> str | None:
        """Принять вызов. Возвращает текст ошибки или None."""
        duel = await self.db.get_duel(duel_id)
        if not duel or duel.status is not Status.CHALLENGED or user_id != duel.target_id:
            return "Вызов уже недействителен."
        now = time.time()
        if now > duel.deadline_at:
            return "Вызов истёк."
        for uid in duel.players:
            if await self.db.active_duel_for(uid, exclude_id=duel.id):
                return "Один из игроков уже участвует в другой дуэли."
        staking = duel.stake_kind != "none"
        ttl = self.s.stake_ttl if staking else self.s.ready_ttl
        if not await self.db.transition(duel.id, Status.STAKING if staking else Status.LOBBY,
                                        accepted_at=now, deadline_at=now + ttl):
            return "Вызов уже недействителен."
        if not staking:
            for uid in duel.players:
                await self.db.set_dp(duel.id, uid, funded=True)
        duel = await self.db.get_duel(duel.id)  # type: ignore[assignment]
        unreachable = await self._send_widgets(duel)
        if staking:
            for uid in duel.players:
                if uid in unreachable:
                    continue
                try:
                    await self.provider(duel).begin(duel, only=uid)
                except StakeError as e:
                    log.warning("stake begin failed: %s", e)
                    await self.cancel_duel(duel.id, Reason.ABORTED)
                    return "Не удалось выставить ставку, дуэль отменена."
        for uid in unreachable:
            await self._ask_to_start(duel, uid)
        return None

    async def _send_widgets(self, duel: Duel, only: int | None = None) -> list[int]:
        """Шлёт виджет дуэли в личку. Возвращает тех, кому написать нельзя (не нажали Start)."""
        unreachable = []
        for uid in duel.players:
            if only is not None and uid != only:
                continue
            dp = await self.db.get_dp(duel.id, uid)
            if dp and dp.widget_message_id:
                continue
            opp = await self.db.get_player(duel.opponent(uid))
            phase = "stake" if duel.stake_kind != "none" else "lobby"
            stake = {}
            if duel.stake_kind != "none":
                stake = {"stake_kind": duel.stake_kind,
                         "stake_label": stake_amount_label(duel.stake_kind, duel.stake_amount)}
            data = duel_state(self._next_rev(duel.id, uid), phase, duel_id=duel.id,
                              opponent=opp.display if opp else None, **stake)
            try:
                msg = await self.raw.send_widget(
                    uid, duel_html(), caption=f"🤠 Дуэль №{duel.id}: против {opp.display if opp else '?'}",
                    chat_data=data, allow_queries=True, height=320)
            except BotApiError as e:
                if e.is_unreachable_user:
                    await self.db.set_can_dm(uid, False)
                    unreachable.append(uid)
                    continue
                log.exception("sendWidget failed for %s", uid)
                unreachable.append(uid)
                continue
            self.last_state[(duel.id, uid)] = data
            await self.db.set_dp(duel.id, uid, widget_message_id=msg["message_id"])
        return unreachable

    async def _ask_to_start(self, duel: Duel, uid: int) -> None:
        p = await self.db.get_player(uid)
        who = p.display if p else str(uid)
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
            text="Открыть бота и нажать Start", url=f"https://t.me/{self.bot_username}?start=duel_{duel.id}")]])
        await self._group(duel, f"⏳ {escape(who)}, чтобы начать дуэль №{duel.id}, нажми Start у бота "
                                f"({max(1, int((duel.deadline_at - time.time()) // 60))} мин).", kb)

    async def resume_for_player(self, duel_id: int, uid: int) -> None:
        """Игрок нажал Start по deep-link: досылаем виджет (и счёт для Stars)."""
        duel = await self.db.get_duel(duel_id)
        if not duel or duel.status not in (Status.STAKING, Status.LOBBY) or uid not in duel.players:
            return
        if await self._send_widgets(duel, only=uid):
            return
        if duel.status is Status.STAKING:
            try:
                await self.provider(duel).begin(duel, only=uid)
            except StakeError:
                log.exception("begin after /start failed")
                await self.cancel_duel(duel.id, Reason.ABORTED)

    # ------------------------------------------------------------------ запросы виджета
    async def on_widget_query(self, wq: dict, t_recv: float) -> str | None:
        """Обрабатывает widget_query и возвращает data для answerWidgetQuery. t_recv — монотонное
        время получения апдейта ботом: это «время нажатия» для судьи (клиенту не верим)."""
        uid = (wq.get("from") or {}).get("id")
        chat, message_id = wq.get("chat") or {}, wq.get("message_id")
        data = wq.get("data") or ""
        qtype = wq.get("type") or {"type": "data"}
        if uid is None or chat.get("id") is None or message_id is None:
            return None
        if data.startswith("st:") and data[3:].isdigit():   # карточка игрока просит свежую статистику
            p = await self.db.get_player(int(data[3:]))
            return stats_card(p, await self.db.rank_of(p.user_id)) if p else None
        dp = await self.db.find_dp_by_widget(uid, message_id)
        if dp is None:
            return json.dumps({"e": "late"}, separators=(",", ":"))
        duel = await self.db.get_duel(dp.duel_id)
        if duel is None:
            return json.dumps({"e": "late"}, separators=(",", ":"))

        if data == "p":
            self.record_press(duel.id, uid, t_recv)
            return json.dumps({"e": "принято"}, ensure_ascii=False)
        if data == "rematch":
            return json.dumps({"e": await self._rematch(duel, uid)}, ensure_ascii=False)
        if qtype.get("type") == "sent_transaction":
            ton = self.providers.get("ton")
            if ton and hasattr(ton, "on_sent_transaction"):
                ok = await ton.on_sent_transaction(duel, uid, qtype.get("wallet") or {}, qtype.get("msg_hash", ""))
                return json.dumps({"e": "ok" if ok else "bad"}, separators=(",", ":"))
            return json.dumps({"e": "bad"}, separators=(",", ":"))
        if data == "hi":
            rt = self.rt.get(duel.id)
            if rt:
                rt.last_bg[uid] = t_recv
            else:
                self._bg_seen[(duel.id, uid)] = t_recv
            await self.db.set_dp(duel.id, uid, ready=True)
            self._spawn(self._maybe_start(duel.id))
            return self.last_state.get((duel.id, uid)) or self._state_from_db(duel, uid)
        if data.startswith("ack:"):
            self._on_ack(duel.id, uid, data[4:], t_recv)
            return None
        if data == "join" and duel.stake_kind == "ton":
            ton = self.providers["ton"]
            err = await ton.on_join(duel, uid, qtype.get("wallet_card"))
            if err:
                return json.dumps({"e": err}, separators=(",", ":"))
            self._spawn(self._on_funded(duel.id))
            return json.dumps({"e": "ставка принята"}, ensure_ascii=False)
        if data == "pay" and duel.stake_kind == "ton":
            ton = self.providers["ton"]
            tx = await ton.on_pay_request(duel, uid, qtype.get("wallet_card"))
            return json.dumps(tx, separators=(",", ":"))
        return None

    async def _rematch(self, duel: Duel, uid: int) -> str:
        """Кнопка «Реванш» в виджете: новый вызов сопернику в ту же группу. Короткий ответ для виджета."""
        if duel.status is not Status.FINISHED:
            return "дуэль ещё не закончена"
        me, opp = await self.db.get_player(uid), await self.db.get_player(duel.opponent(uid))
        if me is None or opp is None:
            return "игрок не найден"
        spec = NO_STAKE if duel.stake_kind == "none" else StakeSpec(StakeKind(duel.stake_kind), duel.stake_amount)
        text = unescape(await self.challenge(duel.chat_id, me, opp, spec))
        return "вызов отправлен в группу 🤠" if text.startswith("Вызов отправлен") else trunc(text, 160)

    def _state_from_db(self, duel: Duel, uid: int) -> str | None:
        if duel.status in (Status.FINISHED, Status.CANCELLED) and duel.outcome:
            ms = {duel.challenger_id: duel.challenger_ms, duel.target_id: duel.target_ms}
            res = RoundResult(Outcome(duel.outcome), Reason(duel.reason or "aborted"), duel.winner_id,
                              duel.loser_id, ms)
            return duel_state(self._next_rev(duel.id, uid), final_phase(res, uid), duel_id=duel.id,
                              ms=ms.get(uid), opp_ms=ms.get(duel.opponent(uid)), reason=res.reason)
        return None

    def record_press(self, duel_id: int, uid: int, t: float) -> bool:
        rt = self.rt.get(duel_id)
        if rt is None or rt.phase not in ("wait", "go"):
            return False
        st = rt.states[uid]
        if st.press_at is not None:
            return False
        rt.states[uid] = replace(st, press_at=t, early=st.t_signal is None)
        rt.changed.set()
        return True

    def _on_ack(self, duel_id: int, uid: int, nonce: str, t: float) -> None:
        rt = self.rt.get(duel_id)
        if rt is None:
            return
        rt.last_bg[uid] = t
        ack = rt.acks.get(uid)
        if ack and str(ack.nonce) == nonce and ack.rtt is None:
            ack.rtt = t - ack.sent_at
            ack.event.set()

    # ------------------------------------------------------------------ ставки и старт
    async def on_funded(self, duel_id: int) -> None:
        await self._on_funded(duel_id)

    async def _on_funded(self, duel_id: int) -> None:
        duel = await self.db.get_duel(duel_id)
        if duel is None or duel.status is not Status.STAKING:
            return
        dps = await self.db.list_dp(duel_id)
        if not all(dp.funded for dp in dps):
            return
        if not await self.db.transition(duel_id, Status.LOBBY, deadline_at=time.time() + self.s.ready_ttl):
            return
        duel = await self.db.get_duel(duel_id)  # type: ignore[assignment]
        for uid in duel.players:
            await self._push(duel, uid, "lobby")
        await self._maybe_start(duel_id)

    async def _maybe_start(self, duel_id: int) -> None:
        async with self._start_lock:
            duel = await self.db.get_duel(duel_id)
            if duel is None or duel.status is not Status.LOBBY:
                return
            dps = await self.db.list_dp(duel_id)
            if len(dps) != 2 or not all(dp.ready and dp.funded for dp in dps):
                return
            if not await self.db.transition(duel_id, Status.ROUND, deadline_at=time.time() + ROUND_HARD_CAP):
                return
            rt = Runtime(duel_id, duel.players, {u: PlayerState(user_id=u) for u in duel.players})
            for u in duel.players:
                if (duel_id, u) in self._bg_seen:
                    rt.last_bg[u] = self._bg_seen.pop((duel_id, u))
            self.rt[duel_id] = rt
            rt.task = self._spawn(self._run_round(duel_id))

    # ------------------------------------------------------------------ раунд
    async def _run_round(self, duel_id: int) -> None:
        rt = self.rt[duel_id]
        duel = await self.db.get_duel(duel_id)
        assert duel is not None
        cfg = self.s.judge_config()
        try:
            await self._measure(duel, rt)
            for u in duel.players:
                rt.states[u] = replace(rt.states[u], rtt_s=rt.rtt[u])
            delay = random_delay(self.rng, self.s.delay_min, self.s.delay_max)
            rt.phase = "wait"
            await asyncio.gather(*(self._push(duel, u, "wait") for u in duel.players))
            wait_until = time.monotonic() + delay
            result: RoundResult | None = None
            # --- «Приготовься…»: любое нажатие здесь — фальстарт ---
            while result is None:
                a, b = (rt.states[u] for u in duel.players)
                ev = evaluate(a, b, cfg, time.monotonic())
                if ev.result:
                    result = ev.result
                    break
                now = time.monotonic()
                remaining = wait_until - now
                if ev.wake_at is not None:
                    # висит неподтверждённый фальстарт: сигнал не подаём, ждём решения судьи
                    timeout = max(0.0, ev.wake_at - now)
                elif remaining <= 0:
                    break
                else:
                    timeout = remaining
                await self._wait_change(rt, timeout)
            # --- сигнал: время фиксирует сервер непосредственно перед отправкой каждому ---
            if result is None:
                rt.phase = "go"

                async def signal(u: int) -> None:
                    rt.states[u] = replace(rt.states[u], t_signal=time.monotonic())
                    await self._push(duel, u, "go")

                await asyncio.gather(*(signal(u) for u in duel.players))
                while result is None:
                    a, b = (rt.states[u] for u in duel.players)
                    ev = evaluate(a, b, cfg, time.monotonic())
                    if ev.result:
                        result = ev.result
                        break
                    timeout = None if ev.wake_at is None else max(0.0, ev.wake_at - time.monotonic())
                    await self._wait_change(rt, timeout if timeout is not None else 1.0)
            await self._finish(duel, result)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("round %s crashed", duel_id)
            await self._finish(duel, RoundResult(Outcome.CANCELLED, Reason.ABORTED))
        finally:
            rt.phase = "done"
            self.rt.pop(duel_id, None)

    @staticmethod
    async def _wait_change(rt: Runtime, timeout: float) -> None:
        # между evaluate() и clear() нет await, поэтому событие не потеряется
        rt.changed.clear()
        try:
            await asyncio.wait_for(rt.changed.wait(), timeout)
        except TimeoutError:
            pass

    async def _measure(self, duel: Duel, rt: Runtime) -> None:
        samples: dict[int, list[float]] = {u: [] for u in duel.players}
        for _ in range(self.s.ping_samples):
            await asyncio.gather(*(self._ping_one(duel, rt, u, samples[u]) for u in duel.players))
        for u in duel.players:
            rt.rtt[u] = estimate_rtt(samples[u], self.s.default_rtt_ms / 1000, self.s.max_rtt_ms / 1000)

    async def _ping_one(self, duel: Duel, rt: Runtime, uid: int, out: list[float]) -> None:
        # виджет может спросить бота без тапа не чаще раза в 5 с: не просим раньше
        gap = rt.last_bg.get(uid, float("-inf")) + BG_REQUEST_GAP - time.monotonic()
        if gap > 0:
            await asyncio.sleep(gap)
        nonce = self.rng.randrange(1, 10**9)
        ack = AckWait(nonce, time.monotonic())
        rt.acks[uid] = ack
        ack.sent_at = time.monotonic()   # метка непосредственно перед отправкой
        await self._push(duel, uid, "lobby", nonce=nonce)
        try:
            await asyncio.wait_for(ack.event.wait(), ACK_TIMEOUT)
            if ack.rtt is not None:
                out.append(ack.rtt)
        except TimeoutError:
            log.info("no ping ack from %s, using default RTT", uid)

    # ------------------------------------------------------------------ завершение
    async def _finish(self, duel: Duel, result: RoundResult) -> None:
        current = await self.db.get_duel(duel.id)
        if current is None or current.status in (Status.FINISHED, Status.CANCELLED):
            return
        provider = self.provider(duel)
        if not await self.db.finish_duel(duel, result, k=self.s.elo_k):
            return
        try:
            settlement = (await provider.cancel(duel)) if result.outcome is Outcome.CANCELLED \
                else (await provider.settle(duel, result))
        except Exception:  # noqa: BLE001
            log.exception("settlement failed for duel %s", duel.id)
            settlement = "⚠ Расчёт по ставке не удался, владелец бота разберётся вручную."
        if settlement:
            await self.db.update_duel(duel.id, settlement=settlement)
        duel = await self.db.get_duel(duel.id)  # type: ignore[assignment]
        players = await self._players(duel)
        claim = await self.db.get_claim(duel.id) if duel.stake_kind == "ton" else None
        for uid in duel.players:
            kw: dict = {"claim": "o" if uid == claim.payer_id else "w"} if claim else {}
            delta = duel.delta_for(uid)
            if delta is not None and players.get(uid):
                kw.update(rating=players[uid].rating, delta=delta)
            await self._push(duel, uid, final_phase(result, uid), ms=result.reaction_ms.get(uid),
                             opp_ms=result.reaction_ms.get(duel.opponent(uid)), reason=result.reason, **kw)
        if duel.accepted_at:
            markup = None
            if result.outcome is not Outcome.CANCELLED:
                markup = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                    text="🔁 Реванш", callback_data=f"d:r:{duel.id}")]])
            await self._group(duel, result_text(duel, result, players, settlement), markup)
        if result.outcome is not Outcome.CANCELLED:
            self.leaderboard.request_refresh()

    async def cancel_duel(self, duel_id: int, reason: Reason, by: int | None = None) -> None:
        duel = await self.db.get_duel(duel_id)
        if duel is None or duel.status in (Status.FINISHED, Status.CANCELLED):
            return
        rt = self.rt.get(duel_id)
        if rt and rt.task and not rt.task.done() and rt.task is not asyncio.current_task():
            rt.task.cancel()
        self.rt.pop(duel_id, None)
        was_challenge = duel.status is Status.CHALLENGED
        await self._finish(duel, RoundResult(Outcome.CANCELLED, reason))
        if was_challenge:
            await self._tell_challenge_closed(duel, reason)
        elif reason is Reason.WITHDRAWN and by is not None:
            # после принятия: второй игрок узнаёт об отмене в личке (виджет и так покажет «отменена»)
            other = duel.opponent(by)
            p = await self.db.get_player(by)
            await self._dm(other, f"⏹ {escape(p.display) if p else 'Соперник'} отменил дуэль №{duel.id}.")

    async def _tell_challenge_closed(self, duel: Duel, reason: Reason) -> None:
        """Вызов закрыт до принятия: обновить приглашение у вызванного и сообщить вызывающему."""
        target_text = {Reason.DECLINED: "Вы отказались от дуэли.", Reason.TIMEOUT: "Вызов истёк.",
                       Reason.WITHDRAWN: "Вызов отозван."}.get(reason)
        if duel.ephemeral_id and target_text:
            try:
                await self.raw.edit_ephemeral_text(duel.chat_id, duel.target_id, duel.ephemeral_id, target_text)
            except BotApiError:
                pass
        target = await self.db.get_player(duel.target_id)
        who = escape(target.display) if target else str(duel.target_id)
        # ABORTED (вызов не удалось доставить) и WITHDRAWN (отменил сам) — вызывающий уже в курсе
        msg = {Reason.DECLINED: f"{who} отказался от дуэли.",
               Reason.TIMEOUT: f"{who} не принял вызов вовремя."}.get(reason)
        challenger = await self.db.get_player(duel.challenger_id)
        if msg and challenger and challenger.can_dm:
            await self._dm(duel.challenger_id, msg)

    # ------------------------------------------------------------------ фоновые задачи
    async def sweep_once(self) -> None:
        for duel in await self.db.expired_duels(time.time()):
            await self.cancel_duel(duel.id, Reason.TIMEOUT)

    async def recover(self) -> None:
        """После перезапуска раунды в памяти потеряны: отменяем и возвращаем ставки."""
        for duel in await self.db.active_duels():
            if duel.status is Status.ROUND:
                await self.cancel_duel(duel.id, Reason.ABORTED)

    async def run_background(self) -> None:
        stars = self.providers.get("stars")
        ton = self.providers.get("ton")
        tick = 0
        while True:
            try:
                await self.sweep_once()
                if tick % 30 == 0 and stars is not None and hasattr(stars, "retry_failed_refunds"):
                    await stars.retry_failed_refunds()
                if tick % 7 == 0 and ton is not None and hasattr(ton, "verify_claims"):
                    for claim, event in await ton.verify_claims():
                        await self._notify_claim(claim, event)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("background loop error")
            tick += 1
            await asyncio.sleep(2)

    async def _notify_claim(self, claim, event: str) -> None:
        duel = await self.db.get_duel(claim.duel_id)
        if duel is None:
            return
        amount = format_ton(claim.amount_nano)
        if event == "confirmed":
            await self._dm(claim.payee_id, f"✅ Получено {amount} TON по дуэли №{duel.id}.")
            await self._dm(claim.payer_id, f"✅ Платёж {amount} TON по дуэли №{duel.id} подтверждён.")
            await self._group(duel, f"✅ Дуэль №{duel.id}: проигравший заплатил {amount} TON.")
            for uid, q in ((claim.payer_id, "p"), (claim.payee_id, "p")):
                dp = await self.db.get_dp(duel.id, uid)
                if dp and dp.widget_message_id:
                    await self._push(duel, uid, "win" if uid == claim.payee_id else "lose", claim=q)
        else:
            await self._dm(claim.payee_id, f"⚠ Проигравший не заплатил {amount} TON по дуэли №{duel.id}.")
            await self._group(duel, f"⚠ Дуэль №{duel.id}: проигравший не оплатил {amount} TON вовремя; "
                                    "для TON-ставок он заблокирован, пока не заплатит.")
            for uid in (claim.payer_id, claim.payee_id):
                await self._push(duel, uid, "win" if uid == claim.payee_id else "lose", claim="u")

    async def shutdown(self) -> None:
        for t in list(self._tasks):
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
