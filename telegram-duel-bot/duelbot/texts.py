"""Тексты для чата (HTML parse_mode)."""
from __future__ import annotations

from html import escape

from .engine.models import Outcome, Reason, RoundResult
from .stakes.ton_utils import format_ton
from .storage.db import Duel, Player


def name(p: Player | None, uid: int | None = None) -> str:
    if p is None:
        return str(uid)
    return escape(p.display)


def stake_label(duel_or_kind, amount: int | None = None) -> str:
    kind, amt = (duel_or_kind.stake_kind, duel_or_kind.stake_amount) if amount is None else (duel_or_kind, amount)
    if kind == "stars":
        return f"{amt} ⭐"
    if kind == "ton":
        return f"{format_ton(amt)} TON"
    return "на интерес"


def stake_amount_label(kind: str, amount: int) -> str:
    return str(amount) if kind == "stars" else format_ton(amount)


def challenge_text(challenger: Player, duel: Duel, ttl_min: int) -> str:
    return (f"🤠 <b>{name(challenger)}</b> вызывает тебя на дуэль!\n"
            f"Ставка: <b>{stake_label(duel)}</b>\n"
            f"Вызов действует {ttl_min} мин. Этого сообщения больше никто не видит.")


CANCEL_REASONS = {
    Reason.TIMEOUT: "время вышло",
    Reason.DECLINED: "вызов отклонён",
    Reason.NO_RESPONSE: "никто не нажал вовремя",
    Reason.ONE_SIDED_TIMEOUT: "один из игроков не ответил в раунде",
    Reason.ABORTED: "сбой бота",
}


def result_text(duel: Duel, result: RoundResult, players: dict[int, Player], settlement: str = "") -> str:
    def n(uid):
        return name(players.get(uid), uid)

    def ms(uid):
        v = result.reaction_ms.get(uid)
        return f"{v:.0f} мс" if v is not None else "—"

    a, b = duel.challenger_id, duel.target_id
    if result.outcome is Outcome.WIN:
        w, l = result.winner_id, result.loser_id
        if result.reason is Reason.FALSE_START:
            head = f"🤠 <b>{n(w)}</b> победил: {n(l)} схватился за кольт до сигнала — фальстарт!"
        elif result.reason is Reason.TOO_FAST:
            head = f"🤠 <b>{n(w)}</b> победил: {n(l)} нажал слишком рано (быстрее человеческой реакции)."
        elif result.reason is Reason.OPPONENT_TIMEOUT:
            head = f"🤠 <b>{n(w)}</b> победил: {n(l)} не нажал."
        else:
            head = f"🤠 <b>{n(w)}</b> победил <b>{n(l)}</b>!\n⚡ {ms(w)} против {ms(l)}"
    elif result.outcome is Outcome.DRAW:
        if result.reason is Reason.BOTH_FALSE_START:
            head = f"🤝 Ничья: {n(a)} и {n(b)} нажали до сигнала."
        else:
            head = f"🤝 Ничья: {n(a)} {ms(a)}, {n(b)} {ms(b)} — разница в пределах погрешности."
    else:
        head = f"⏹ Дуэль {n(a)} и {n(b)} отменена: {CANCEL_REASONS.get(result.reason, 'сбой')}."
    return head + (f"\n{settlement}" if settlement else "")


HELP = (
    "🤠 <b>Ковбойская дуэль</b>\n\n"
    "В группе: <code>/duel @username</code> — вызвать игрока. Он получит приватное приглашение.\n"
    "Со ставкой: <code>/duel @username 50 stars</code> или <code>/duel @username 0.5 ton</code> "
    "(если включено).\n"
    "<code>/leaderboard</code> — табло дуэлянтов.\n\n"
    "Дуэль идёт в личке с ботом: на экране «Приготовься…», потом он становится красным — "
    "жми первым. Нажал раньше — фальстарт и поражение.\n"
    "Чтобы получать дуэли, нажми Start у бота."
)

TERMS = (
    "<b>Условия</b>\n"
    "Режим «на интерес» бесплатный. Ставки в Stars: ставка списывается заранее; победителю возвращается "
    "его ставка, ставка проигравшего остаётся у бота (Bot API не умеет переводить Stars между игроками). "
    "При ничьей и отмене ставки возвращаются.\n"
    "Ставки в TON: проигравший сам платит победителю напрямую со своего кошелька; бот деньги не хранит и "
    "не гарантирует оплату, неплательщик блокируется для TON-ставок.\n"
    "Играя на деньги, вы отвечаете за соблюдение законов своей страны."
)

PAYSUPPORT = ("По вопросам платежей напишите владельцу бота. Поддержка Telegram по платежам в ботах помочь "
              "не сможет. Укажите номер дуэли.")
