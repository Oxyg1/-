CREATE TABLE IF NOT EXISTS players (
    user_id       INTEGER PRIMARY KEY,
    username      TEXT,
    first_name    TEXT NOT NULL DEFAULT '',
    can_dm        INTEGER NOT NULL DEFAULT 0,      -- нажал Start у бота
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    draws         INTEGER NOT NULL DEFAULT 0,
    false_starts  INTEGER NOT NULL DEFAULT 0,
    best_ms       REAL,
    ton_blocked   INTEGER NOT NULL DEFAULT 0,      -- не оплатил проигрыш в TON
    rating        INTEGER NOT NULL DEFAULT 1000,   -- Эло
    streak        INTEGER NOT NULL DEFAULT 0,      -- текущая серия побед
    best_streak   INTEGER NOT NULL DEFAULT 0,
    react_sum     REAL NOT NULL DEFAULT 0,         -- сумма «чистых» реакций (для среднего)
    react_n       INTEGER NOT NULL DEFAULT 0,
    updated_at    REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_players_username ON players(username COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS duels (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id         INTEGER NOT NULL,
    challenger_id   INTEGER NOT NULL,
    target_id       INTEGER NOT NULL,
    status          TEXT NOT NULL,
    stake_kind      TEXT NOT NULL DEFAULT 'none',  -- none | stars | ton
    stake_amount    INTEGER NOT NULL DEFAULT 0,    -- stars: Stars; ton: нанотоны
    created_at      REAL NOT NULL,
    deadline_at     REAL NOT NULL,
    ephemeral_id    INTEGER,                       -- эфемерный вызов у целевого игрока
    accepted_at     REAL,
    finished_at     REAL,
    outcome         TEXT,
    reason          TEXT,
    winner_id       INTEGER,
    loser_id        INTEGER,
    challenger_ms   REAL,
    target_ms       REAL,
    settlement      TEXT,                           -- текстовый итог по ставке
    challenger_delta INTEGER,                       -- изменение рейтинга
    target_delta    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_duels_pair ON duels(challenger_id, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_duels_status ON duels(status, deadline_at);

CREATE TABLE IF NOT EXISTS duel_players (
    duel_id            INTEGER NOT NULL REFERENCES duels(id),
    user_id            INTEGER NOT NULL,
    widget_message_id  INTEGER,
    ready              INTEGER NOT NULL DEFAULT 0,
    funded             INTEGER NOT NULL DEFAULT 0,
    wallet_address     TEXT,                       -- TON: адрес из TonWalletCard
    wallet_balance     TEXT,
    PRIMARY KEY (duel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dp_widget ON duel_players(user_id, widget_message_id);

CREATE TABLE IF NOT EXISTS star_payments (
    charge_id   TEXT PRIMARY KEY,                  -- telegram_payment_charge_id
    duel_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    amount      INTEGER NOT NULL,
    status      TEXT NOT NULL,                     -- paid | refunded | retained | refund_failed
    created_at  REAL NOT NULL,
    note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sp_duel ON star_payments(duel_id);

CREATE TABLE IF NOT EXISTS ton_claims (
    duel_id         INTEGER PRIMARY KEY,
    payer_id        INTEGER NOT NULL,
    payee_id        INTEGER NOT NULL,
    payee_address   TEXT NOT NULL,
    payer_address   TEXT,                          -- адрес из карточки; настоящий отправитель — wallet из sent_transaction
    reported_sender TEXT,
    amount_nano     INTEGER NOT NULL,              -- победителю (ставка минус комиссия)
    fee_address     TEXT,                          -- кошелёк комиссии
    fee_nano        INTEGER NOT NULL DEFAULT 0,
    fee_tx_hash     TEXT,
    comment         TEXT NOT NULL,
    created_at      REAL NOT NULL,
    deadline_at     REAL NOT NULL,
    status          TEXT NOT NULL,                 -- pending | tx_reported | confirmed | unpaid
    reported_msg_hash TEXT,
    tx_hash         TEXT UNIQUE,
    confirmed_at    REAL
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON ton_claims(status);

CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- поиск соперника (/cfind): кто ждёт и в каком виджете
CREATE TABLE IF NOT EXISTS queue (
    user_id     INTEGER PRIMARY KEY,
    rating      INTEGER NOT NULL,
    message_id  INTEGER NOT NULL,                  -- сообщение «Ищем соперника…» в личке
    joined_at   REAL NOT NULL
);
