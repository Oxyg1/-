"""Что делать со ставками после раунда. Чистая логика, без вызовов API."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .models import Outcome, RoundResult


class StarsAction(StrEnum):
    REFUND = "refund"   # вернуть Stars плательщику
    RETAIN = "retain"   # оставить на балансе бота


def stars_plan(result: RoundResult, players: tuple[int, int]) -> dict[int, StarsAction]:
    """Stars: победитель получает свою ставку назад, ставка проигравшего остаётся у бота.

    Bot API не умеет переводить Stars между пользователями, поэтому «банк» победителю
    выплатить нельзя. Ничья и отмена — возврат обоим.
    """
    if result.outcome is Outcome.WIN:
        return {
            uid: StarsAction.REFUND if uid == result.winner_id else StarsAction.RETAIN
            for uid in players
        }
    return {uid: StarsAction.REFUND for uid in players}


@dataclass(frozen=True)
class TonClaim:
    payer_id: int
    payee_id: int


def ton_claim(result: RoundResult) -> TonClaim | None:
    """TON: проигравший должен заплатить победителю напрямую. В остальных исходах долга нет."""
    if result.outcome is Outcome.WIN and result.winner_id is not None and result.loser_id is not None:
        return TonClaim(payer_id=result.loser_id, payee_id=result.winner_id)
    return None
