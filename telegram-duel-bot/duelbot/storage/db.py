"""SQLite-хранилище на aiosqlite: игроки, дуэли, платежи, долги в TON."""
from __future__ import annotations

import time
from dataclasses import dataclass
from importlib import resources
from typing import Any

import aiosqlite

from ..engine.models import Outcome, RoundResult
from ..engine.rating import DEFAULT_K, Stats, apply_result, rating_deltas
from ..engine.states import ACTIVE, Status, require_transition


@dataclass
class Player:
    user_id: int
    username: str | None
    first_name: str
    can_dm: bool
    wins: int = 0
    losses: int = 0
    draws: int = 0
    false_starts: int = 0
    best_ms: float | None = None
    ton_blocked: bool = False
    rating: int = 1000
    streak: int = 0
    best_streak: int = 0
    react_sum: float = 0.0
    react_n: int = 0

    @property
    def display(self) -> str:
        return f"@{self.username}" if self.username else (self.first_name or str(self.user_id))

    @property
    def stats(self) -> Stats:
        return Stats(self.user_id, self.wins, self.losses, self.draws, self.false_starts, self.best_ms,
                     self.rating, self.streak, self.best_streak, self.react_sum, self.react_n)


@dataclass
class Duel:
    id: int
    chat_id: int
    challenger_id: int
    target_id: int
    status: Status
    stake_kind: str
    stake_amount: int
    created_at: float
    deadline_at: float
    ephemeral_id: int | None
    accepted_at: float | None
    finished_at: float | None
    outcome: str | None
    reason: str | None
    winner_id: int | None
    loser_id: int | None
    challenger_ms: float | None
    target_ms: float | None
    settlement: str | None
    challenger_delta: int | None = None
    target_delta: int | None = None

    @property
    def players(self) -> tuple[int, int]:
        return (self.challenger_id, self.target_id)

    def opponent(self, uid: int) -> int:
        return self.target_id if uid == self.challenger_id else self.challenger_id

    def delta_for(self, uid: int) -> int | None:
        return self.challenger_delta if uid == self.challenger_id else self.target_delta


@dataclass
class DuelPlayer:
    duel_id: int
    user_id: int
    widget_message_id: int | None
    ready: bool
    funded: bool
    wallet_address: str | None
    wallet_balance: str | None


@dataclass
class TonClaim:
    duel_id: int
    payer_id: int
    payee_id: int
    payee_address: str
    payer_address: str | None
    reported_sender: str | None
    amount_nano: int
    comment: str
    created_at: float
    deadline_at: float
    status: str
    reported_msg_hash: str | None
    tx_hash: str | None
    confirmed_at: float | None
    fee_address: str | None = None
    fee_nano: int = 0
    fee_tx_hash: str | None = None

    @property
    def fully_paid(self) -> bool:
        return bool(self.tx_hash) and (self.fee_nano <= 0 or bool(self.fee_tx_hash))


@dataclass
class QueueEntry:
    user_id: int
    rating: int
    message_id: int
    joined_at: float
    seen_at: float | None


@dataclass
class StarPayment:
    charge_id: str
    duel_id: int
    user_id: int
    amount: int
    status: str
    created_at: float
    note: str | None


_DUEL_COLS = {
    "status", "ephemeral_id", "accepted_at", "finished_at", "outcome", "reason", "winner_id",
    "loser_id", "challenger_ms", "target_ms", "settlement", "deadline_at", "stake_kind", "stake_amount",
}
_DP_COLS = {"widget_message_id", "ready", "funded", "wallet_address", "wallet_balance"}
_CLAIM_COLS = {"payer_address", "reported_sender", "status", "reported_msg_hash", "tx_hash",
               "confirmed_at", "deadline_at", "fee_tx_hash"}
_PAY_COLS = {"status", "note"}

# Колонки, добавленные после первой версии схемы. CREATE TABLE IF NOT EXISTS не меняет старые таблицы,
# поэтому недостающие колонки доливаем ALTER TABLE при старте.
_MIGRATIONS: list[tuple[str, str, str]] = [
    ("players", "rating", "INTEGER NOT NULL DEFAULT 1000"),
    ("players", "streak", "INTEGER NOT NULL DEFAULT 0"),
    ("players", "best_streak", "INTEGER NOT NULL DEFAULT 0"),
    ("players", "react_sum", "REAL NOT NULL DEFAULT 0"),
    ("players", "react_n", "INTEGER NOT NULL DEFAULT 0"),
    ("duels", "challenger_delta", "INTEGER"),
    ("duels", "target_delta", "INTEGER"),
    ("ton_claims", "fee_address", "TEXT"),
    ("ton_claims", "fee_nano", "INTEGER NOT NULL DEFAULT 0"),
    ("ton_claims", "fee_tx_hash", "TEXT"),
]


class Database:
    def __init__(self, conn: aiosqlite.Connection):
        self._c = conn

    @classmethod
    async def connect(cls, path: str) -> Database:
        conn = await aiosqlite.connect(path)
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.execute("PRAGMA busy_timeout=5000")
        schema = resources.files("duelbot.storage").joinpath("schema.sql").read_text(encoding="utf-8")
        await conn.executescript(schema)
        await cls._migrate(conn)
        await conn.commit()
        return cls(conn)

    @staticmethod
    async def _migrate(conn: aiosqlite.Connection) -> None:
        for table, col, ddl in _MIGRATIONS:
            async with conn.execute(f"PRAGMA table_info({table})") as cur:
                cols = {r[1] for r in await cur.fetchall()}
            if col not in cols:
                await conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")

    async def close(self) -> None:
        await self._c.close()

    # ---------- helpers ----------
    async def _one(self, sql: str, *args: Any):
        async with self._c.execute(sql, args) as cur:
            return await cur.fetchone()

    async def _all(self, sql: str, *args: Any):
        async with self._c.execute(sql, args) as cur:
            return await cur.fetchall()

    async def _update(self, table: str, allowed: set[str], where: str, where_args: tuple, fields: dict) -> None:
        bad = set(fields) - allowed
        if bad:
            raise ValueError(f"unknown columns {bad}")
        if not fields:
            return
        sets = ", ".join(f"{k}=?" for k in fields)
        await self._c.execute(f"UPDATE {table} SET {sets} WHERE {where}", (*fields.values(), *where_args))
        await self._c.commit()

    # ---------- players ----------
    @staticmethod
    def _player(r) -> Player:
        return Player(r["user_id"], r["username"], r["first_name"], bool(r["can_dm"]), r["wins"], r["losses"],
                      r["draws"], r["false_starts"], r["best_ms"], bool(r["ton_blocked"]), r["rating"],
                      r["streak"], r["best_streak"], r["react_sum"], r["react_n"])

    async def upsert_player(self, user_id: int, username: str | None, first_name: str,
                            can_dm: bool | None = None) -> None:
        now = time.time()
        await self._c.execute(
            """INSERT INTO players(user_id, username, first_name, can_dm, updated_at) VALUES(?,?,?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name,
               can_dm=CASE WHEN ? IS NULL THEN can_dm ELSE ? END, updated_at=excluded.updated_at""",
            (user_id, username, first_name, int(bool(can_dm)), now,
             None if can_dm is None else 1, None if can_dm is None else int(can_dm)),
        )
        await self._c.commit()

    async def set_can_dm(self, user_id: int, value: bool) -> None:
        await self._c.execute("UPDATE players SET can_dm=? WHERE user_id=?", (int(value), user_id))
        await self._c.commit()

    async def get_player(self, user_id: int) -> Player | None:
        r = await self._one("SELECT * FROM players WHERE user_id=?", user_id)
        return self._player(r) if r else None

    async def find_player_by_username(self, username: str) -> Player | None:
        r = await self._one("SELECT * FROM players WHERE username=? COLLATE NOCASE ORDER BY updated_at DESC",
                            username.lstrip("@"))
        return self._player(r) if r else None

    async def set_ton_blocked(self, user_id: int, blocked: bool) -> None:
        await self._c.execute("UPDATE players SET ton_blocked=? WHERE user_id=?", (int(blocked), user_id))
        await self._c.commit()

    # ---------- duels ----------
    @staticmethod
    def _duel(r) -> Duel:
        d = dict(r)
        d["status"] = Status(d["status"])
        return Duel(**d)

    async def create_duel(self, chat_id: int, challenger_id: int, target_id: int, stake_kind: str,
                          stake_amount: int, ttl: float) -> Duel:
        now = time.time()
        cur = await self._c.execute(
            """INSERT INTO duels(chat_id, challenger_id, target_id, status, stake_kind, stake_amount,
               created_at, deadline_at) VALUES(?,?,?,?,?,?,?,?)""",
            (chat_id, challenger_id, target_id, Status.CHALLENGED.value, stake_kind, stake_amount, now, now + ttl),
        )
        duel_id = cur.lastrowid
        for uid in (challenger_id, target_id):
            await self._c.execute("INSERT INTO duel_players(duel_id, user_id) VALUES(?,?)", (duel_id, uid))
        await self._c.commit()
        return await self.get_duel(duel_id)  # type: ignore[return-value]

    async def get_duel(self, duel_id: int) -> Duel | None:
        r = await self._one("SELECT * FROM duels WHERE id=?", duel_id)
        return self._duel(r) if r else None

    async def update_duel(self, duel_id: int, **fields: Any) -> None:
        await self._update("duels", _DUEL_COLS, "id=?", (duel_id,), fields)

    async def transition(self, duel_id: int, dst: Status, **fields: Any) -> bool:
        """Атомарно меняет статус по автомату. False, если переход уже невозможен (гонка)."""
        duel = await self.get_duel(duel_id)
        if duel is None:
            return False
        try:
            require_transition(duel.status, dst)
        except ValueError:
            return False
        bad = set(fields) - _DUEL_COLS
        if bad:
            raise ValueError(f"unknown columns {bad}")
        # статус и сопутствующие поля — одной записью: не бывает «статус сменился, а дедлайн старый»
        sets = ", ".join(["status=?", *(f"{k}=?" for k in fields)])
        cur = await self._c.execute(f"UPDATE duels SET {sets} WHERE id=? AND status=?",
                                    (dst.value, *fields.values(), duel_id, duel.status.value))
        await self._c.commit()
        return cur.rowcount == 1

    async def active_duel_for(self, user_id: int, exclude_id: int | None = None) -> Duel | None:
        marks = ",".join("?" for _ in ACTIVE)
        r = await self._one(
            f"SELECT * FROM duels WHERE status IN ({marks}) AND (challenger_id=? OR target_id=?) "
            "AND id != ? ORDER BY id DESC", *[s.value for s in ACTIVE], user_id, user_id, exclude_id or 0)
        return self._duel(r) if r else None

    async def expired_duels(self, now: float) -> list[Duel]:
        marks = ",".join("?" for _ in ACTIVE)
        rows = await self._all(
            f"SELECT * FROM duels WHERE status IN ({marks}) AND deadline_at < ?",
            *[s.value for s in ACTIVE], now)
        return [self._duel(r) for r in rows]

    async def last_duel_between(self, challenger_id: int, target_id: int) -> Duel | None:
        r = await self._one("SELECT * FROM duels WHERE challenger_id=? AND target_id=? ORDER BY id DESC LIMIT 1",
                            challenger_id, target_id)
        return self._duel(r) if r else None

    async def active_duels(self) -> list[Duel]:
        marks = ",".join("?" for _ in ACTIVE)
        rows = await self._all(f"SELECT * FROM duels WHERE status IN ({marks})", *[s.value for s in ACTIVE])
        return [self._duel(r) for r in rows]

    # ---------- duel_players ----------
    @staticmethod
    def _dp(r) -> DuelPlayer:
        return DuelPlayer(r["duel_id"], r["user_id"], r["widget_message_id"], bool(r["ready"]),
                          bool(r["funded"]), r["wallet_address"], r["wallet_balance"])

    async def get_dp(self, duel_id: int, user_id: int) -> DuelPlayer | None:
        r = await self._one("SELECT * FROM duel_players WHERE duel_id=? AND user_id=?", duel_id, user_id)
        return self._dp(r) if r else None

    async def list_dp(self, duel_id: int) -> list[DuelPlayer]:
        return [self._dp(r) for r in await self._all("SELECT * FROM duel_players WHERE duel_id=?", duel_id)]

    async def set_dp(self, duel_id: int, user_id: int, **fields: Any) -> None:
        for k in ("ready", "funded"):
            if k in fields:
                fields[k] = int(bool(fields[k]))
        await self._update("duel_players", _DP_COLS, "duel_id=? AND user_id=?", (duel_id, user_id), fields)

    async def find_dp_by_widget(self, user_id: int, message_id: int) -> DuelPlayer | None:
        r = await self._one(
            "SELECT * FROM duel_players WHERE user_id=? AND widget_message_id=? ORDER BY duel_id DESC",
            user_id, message_id)
        return self._dp(r) if r else None

    # ---------- результат и рейтинг ----------
    async def finish_duel(self, duel: Duel, result: RoundResult, settlement: str | None = None,
                          k: int = DEFAULT_K) -> bool:
        """Записывает итог, рейтинг и статистику обоих игроков одной транзакцией.

        Возвращает False, если дуэль уже завершена (идемпотентность).
        """
        dst = Status.CANCELLED if result.outcome is Outcome.CANCELLED else Status.FINISHED
        cur_duel = await self.get_duel(duel.id)
        if cur_duel is None or cur_duel.status not in ACTIVE:
            return False
        require_transition(cur_duel.status, dst)
        now = time.time()
        players = {uid: await self.get_player(uid) for uid in duel.players}
        deltas: dict[int, int] = {}
        if all(players.values()) and result.outcome is not Outcome.CANCELLED:
            a, b = (players[u].stats for u in duel.players)  # type: ignore[union-attr]
            deltas = rating_deltas(result, a, b, k)
        cur = await self._c.execute(
            """UPDATE duels SET status=?, finished_at=?, outcome=?, reason=?, winner_id=?, loser_id=?,
               challenger_ms=?, target_ms=?, settlement=COALESCE(?, settlement),
               challenger_delta=?, target_delta=? WHERE id=? AND status=?""",
            (dst.value, now, result.outcome.value, result.reason.value, result.winner_id, result.loser_id,
             result.reaction_ms.get(duel.challenger_id), result.reaction_ms.get(duel.target_id),
             settlement, deltas.get(duel.challenger_id), deltas.get(duel.target_id),
             duel.id, cur_duel.status.value))
        if cur.rowcount != 1:
            await self._c.commit()
            return False
        for uid, p in players.items():
            if p is None:
                continue
            s = apply_result(p.stats, result, deltas.get(uid, 0))
            await self._c.execute(
                """UPDATE players SET wins=?, losses=?, draws=?, false_starts=?, best_ms=?, rating=?, streak=?,
                   best_streak=?, react_sum=?, react_n=? WHERE user_id=?""",
                (s.wins, s.losses, s.draws, s.false_starts, s.best_ms, s.rating, s.streak, s.best_streak,
                 s.react_sum, s.react_n, uid))
        await self._c.commit()
        return True

    async def all_stats(self) -> list[Stats]:
        rows = await self._all("SELECT * FROM players WHERE wins + losses + draws > 0")
        return [self._player(r).stats for r in rows]

    async def rank_of(self, user_id: int) -> int | None:
        """Место игрока в общей таблице (по рейтингу) или None, если он ещё не играл."""
        p = await self.get_player(user_id)
        if p is None or p.stats.games == 0:
            return None
        r = await self._one("SELECT COUNT(*) AS n FROM players WHERE wins + losses + draws > 0 AND rating > ?",
                            p.rating)
        return int(r["n"]) + 1

    async def names_for(self, user_ids: list[int]) -> dict[int, str]:
        if not user_ids:
            return {}
        marks = ",".join("?" for _ in user_ids)
        rows = await self._all(
            f"SELECT user_id, username, first_name FROM players WHERE user_id IN ({marks})", *user_ids)
        return {r["user_id"]: (r["username"] or r["first_name"] or str(r["user_id"])) for r in rows}

    async def last_duels(self, limit: int = 5) -> list[dict]:
        rows = await self._all(
            """SELECT d.id, d.winner_id, d.loser_id, d.challenger_id, d.challenger_ms, d.target_ms,
                      pw.username AS wu, pw.first_name AS wn, pl.username AS lu, pl.first_name AS ln
               FROM duels d
               JOIN players pw ON pw.user_id=d.winner_id JOIN players pl ON pl.user_id=d.loser_id
               WHERE d.outcome='win' ORDER BY d.finished_at DESC LIMIT ?""", limit)
        out = []
        for r in rows:
            ms = r["challenger_ms"] if r["winner_id"] == r["challenger_id"] else r["target_ms"]
            out.append({"winner": r["wu"] or r["wn"], "loser": r["lu"] or r["ln"], "ms": ms})
        return out

    # ---------- Stars ----------
    @staticmethod
    def _pay(r) -> StarPayment:
        return StarPayment(**dict(r))

    async def add_star_payment(self, charge_id: str, duel_id: int, user_id: int, amount: int) -> bool:
        try:
            await self._c.execute(
                "INSERT INTO star_payments(charge_id, duel_id, user_id, amount, status, created_at) "
                "VALUES(?,?,?,?,?,?)", (charge_id, duel_id, user_id, amount, "paid", time.time()))
            await self._c.commit()
            return True
        except aiosqlite.IntegrityError:
            return False  # повторная доставка успешного платежа

    async def star_payments(self, duel_id: int) -> list[StarPayment]:
        return [self._pay(r) for r in await self._all("SELECT * FROM star_payments WHERE duel_id=?", duel_id)]

    async def set_star_payment(self, charge_id: str, **fields: Any) -> None:
        await self._update("star_payments", _PAY_COLS, "charge_id=?", (charge_id,), fields)

    async def failed_refunds(self) -> list[StarPayment]:
        return [self._pay(r) for r in await self._all("SELECT * FROM star_payments WHERE status='refund_failed'")]

    # ---------- TON ----------
    @staticmethod
    def _claim(r) -> TonClaim:
        return TonClaim(**dict(r))

    async def create_claim(self, duel_id: int, payer_id: int, payee_id: int, payee_address: str,
                           payer_address: str | None, amount_nano: int, comment: str, ttl: float,
                           fee_address: str | None = None, fee_nano: int = 0) -> TonClaim:
        now = time.time()
        await self._c.execute(
            """INSERT INTO ton_claims(duel_id, payer_id, payee_id, payee_address, payer_address, amount_nano,
               comment, created_at, deadline_at, status, fee_address, fee_nano)
               VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)""",
            (duel_id, payer_id, payee_id, payee_address, payer_address, amount_nano, comment, now, now + ttl,
             fee_address, fee_nano))
        await self._c.commit()
        return await self.get_claim(duel_id)  # type: ignore[return-value]

    async def get_claim(self, duel_id: int) -> TonClaim | None:
        r = await self._one("SELECT * FROM ton_claims WHERE duel_id=?", duel_id)
        return self._claim(r) if r else None

    async def update_claim(self, duel_id: int, **fields: Any) -> None:
        await self._update("ton_claims", _CLAIM_COLS, "duel_id=?", (duel_id,), fields)

    async def claims_to_verify(self, now: float, grace: float = 24 * 3600) -> list[TonClaim]:
        """Открытые долги и недавно просроченные (платёж мог дойти с опозданием)."""
        rows = await self._all(
            "SELECT * FROM ton_claims WHERE status IN ('pending','tx_reported') "
            "OR (status='unpaid' AND deadline_at > ?)", now - grace)
        return [self._claim(r) for r in rows]

    async def open_claim_for_payer(self, user_id: int) -> TonClaim | None:
        r = await self._one(
            "SELECT * FROM ton_claims WHERE payer_id=? AND status IN ('pending','tx_reported','unpaid') "
            "ORDER BY created_at DESC", user_id)
        return self._claim(r) if r else None

    # ---------- поиск соперника ----------
    async def queue_add(self, user_id: int, rating: int, message_id: int) -> None:
        await self._c.execute("INSERT OR REPLACE INTO queue(user_id, rating, message_id, joined_at) VALUES(?,?,?,?)",
                              (user_id, rating, message_id, time.time()))
        await self._c.commit()

    async def queue_get(self, user_id: int) -> QueueEntry | None:
        r = await self._one("SELECT * FROM queue WHERE user_id=?", user_id)
        return QueueEntry(**dict(r)) if r else None

    async def queue_by_widget(self, user_id: int, message_id: int) -> QueueEntry | None:
        r = await self._one("SELECT * FROM queue WHERE user_id=? AND message_id=?", user_id, message_id)
        return QueueEntry(**dict(r)) if r else None

    async def queue_all(self) -> list[QueueEntry]:
        return [QueueEntry(**dict(r)) for r in await self._all("SELECT * FROM queue ORDER BY joined_at")]

    async def queue_seen(self, user_id: int) -> None:
        await self._c.execute("UPDATE queue SET seen_at=? WHERE user_id=?", (time.time(), user_id))
        await self._c.commit()

    async def queue_remove(self, user_id: int) -> bool:
        cur = await self._c.execute("DELETE FROM queue WHERE user_id=?", (user_id,))
        await self._c.commit()
        return cur.rowcount == 1

    # ---------- kv ----------
    async def kv_get(self, key: str) -> str | None:
        r = await self._one("SELECT value FROM kv WHERE key=?", key)
        return r["value"] if r else None

    async def kv_set(self, key: str, value: str) -> None:
        await self._c.execute(
            "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
        await self._c.commit()
