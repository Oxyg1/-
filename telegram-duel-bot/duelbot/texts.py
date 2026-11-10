"""Тексты для чата (HTML parse_mode)."""
from __future__ import annotations

from html import escape

from . import commands as C
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


def _vs(duel: Duel, players: dict[int, Player]) -> str:
    a, b = duel.players
    return f"<b>{name(players.get(a), a)}</b> ⚔ <b>{name(players.get(b), b)}</b>"


def lobby_text(duel: Duel, players: dict[int, Player], ready: set[int], ttl: int | None) -> str:
    lines = [f"🤠 <b>Дуэль №{duel.id}</b>: {_vs(duel, players)}"]
    if duel.stake_kind != "none":
        lines.append(f"Ставка: <b>{stake_label(duel)}</b>")
    lines.append("")
    for uid in duel.players:
        lines.append(f"{'✅' if uid in ready else '⏳'} {name(players.get(uid), uid)}")
    lines.append("")
    lines.append("Оба жмите «✋ Готов». Потом сообщение сменится на «Приготовься…», а через пару секунд — "
                 "на 🔴 <b>ЖМИ!</b> Кто первый нажмёт «ОГОНЬ», тот победил. Раньше сигнала — фальстарт.")
    if ttl:
        lines.append(f"<i>Ждём {ttl} с.</i>")
    return "\n".join(lines)


def wait_text(duel: Duel, players: dict[int, Player]) -> str:
    return (f"🌵 <b>Дуэль №{duel.id}</b>: {_vs(duel, players)}\n\n"
            "😐 <b>Приготовься…</b>\n\nРуку на кобуру. <b>Не жми</b>, пока сообщение не станет красным!")


def go_text(duel: Duel) -> str:
    return f"🔴🔴🔴🔴🔴🔴🔴🔴\n\n🔥 <b>ЖМИ!  ЖМИ!  ЖМИ!</b> 🔥\n\n🔴🔴🔴🔴🔴🔴🔴🔴\n<i>Дуэль №{duel.id}</i>"


CANCEL_REASONS = {
    Reason.TIMEOUT: "время вышло",
    Reason.DECLINED: "вызов отклонён",
    Reason.NO_RESPONSE: "никто не нажал вовремя",
    Reason.ONE_SIDED_TIMEOUT: "один из игроков не ответил в раунде",
    Reason.ABORTED: "сбой бота",
    Reason.WITHDRAWN: "участник отменил вызов",
}


def plural(n: int, one: str, few: str, many: str) -> str:
    """plural(3, 'победа', 'победы', 'побед') -> '3 победы'."""
    m10, m100 = n % 10, n % 100
    word = one if m10 == 1 and m100 != 11 else few if 2 <= m10 <= 4 and not 12 <= m100 <= 14 else many
    return f"{n} {word}"


def signed(n: int) -> str:
    return f"+{n}" if n > 0 else (f"−{-n}" if n < 0 else "±0")


def rating_line(duel: Duel, players: dict[int, Player]) -> str:
    """«📈 @a 1016 (+16) · @b 984 (−16)». Пусто, если рейтинг не менялся."""
    parts = []
    for uid in duel.players:
        d, p = duel.delta_for(uid), players.get(uid)
        if d is None or p is None:
            continue
        parts.append(f"{name(p)} {p.rating} ({signed(d)})")
    return ("📈 " + " · ".join(parts)) if parts else ""


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
    if result.outcome is not Outcome.CANCELLED:
        if line := rating_line(duel, players):
            head += "\n" + line
        w = players.get(result.winner_id) if result.winner_id else None
        if w and w.streak >= 3:
            head += f"\n🔥 {name(w)}: {plural(w.streak, 'победа', 'победы', 'побед')} подряд!"
    return head + (f"\n{settlement}" if settlement else "")


def top_text(stats: list, names: dict[int, str]) -> str:
    if not stats:
        return f"🤠 <b>Табло дуэлянтов</b>\n\nПока пусто — вызови кого-нибудь: <code>/{C.DUEL} @username</code>"
    medals = {1: "🥇", 2: "🥈", 3: "🥉"}
    lines = ["🤠 <b>Табло дуэлянтов</b>", ""]
    for i, s in enumerate(stats, 1):
        lines.append(f"{medals.get(i, f'{i}.')} {escape(names.get(s.user_id, str(s.user_id)))} — "
                     f"<b>{s.rating}</b> <i>({s.wins}–{s.losses})</i>")
    return "\n".join(lines)


def stats_text(p: Player, rank: int | None) -> str:
    st = p.stats
    if st.games == 0:
        return f"🤠 <b>{name(p)}</b> ещё не провёл ни одной дуэли. Рейтинг: <b>{p.rating}</b>."
    lines = [f"🤠 <b>{name(p)}</b>",
             f"Рейтинг: <b>{p.rating}</b>" + (f" · место #{rank}" if rank else ""),
             f"Дуэлей: {st.games} · 🏆 {st.wins} · 💀 {st.losses} · 🤝 {st.draws} "
             f"({round((st.win_rate or 0) * 100)}% побед)"]
    react = []
    if st.best_ms is not None:
        react.append(f"лучшая {st.best_ms:.0f} мс")
    if st.avg_ms is not None:
        react.append(f"средняя {st.avg_ms:.0f} мс")
    if react:
        lines.append("⚡ Реакция: " + ", ".join(react))
    lines.append(f"🔥 Серия побед: {st.streak} (рекорд {st.best_streak})")
    if st.false_starts:
        lines.append(f"🚫 Фальстартов: {st.false_starts}")
    return "\n".join(lines)


def help_text(group_mode: bool) -> str:
    where = ("Дуэль идёт прямо в группе: бот публикует сообщение, оба жмут «Готов», потом «Приготовься…» и, "
             "через случайные 2–6 секунд, 🔴 «ЖМИ!» — кто первый нажал «ОГОНЬ», тот победил. "
             "Нажал раньше — фальстарт и поражение.\n")
    if not group_mode:
        where = ("Дуэль идёт в личке с ботом: на экране «Приготовься…», потом он становится красным — "
                 "жми первым. Нажал раньше — фальстарт и поражение. Задержка сети вычитается, так что лаг не "
                 "мешает.\n")
    return HELP.replace("{where}", where).replace("{start}", "" if group_mode else
                                                  "\nЧтобы получать дуэли, нажми Start у бота.")


HELP = (
    "🤠 <b>Ковбойская дуэль</b>\n\n"
    f"В группе: <code>/{C.DUEL} @username</code> — вызвать игрока (или ответь командой <code>/{C.DUEL}</code> "
    "на его сообщение). Он получит приватное приглашение.\n"
    f"Со ставкой: <code>/{C.DUEL} @username 50 stars</code> или <code>/{C.DUEL} @username 0.5 ton</code> "
    "(если включено).\n"
    f"<code>/{C.CANCEL}</code> — отменить свой вызов, пока раунд не начался.\n"
    f"<code>/{C.STATS}</code> — твоя статистика и рейтинг (<code>/{C.STATS} @username</code> — чужая).\n"
    f"<code>/{C.TOP}</code> — табло дуэлянтов.\n"
    f"<code>/{C.HELP}</code> — эта справка.\n\n"
    "{where}"
    "После дуэли под итогом есть кнопка «🔁 Реванш».\n"
    f"Ставки в TON: сначала укажи свой кошелёк — <code>/{C.WALLET} адрес</code>."
    "{start}"
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
