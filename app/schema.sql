PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    full_name        TEXT    NOT NULL,
    password_hash    TEXT    NOT NULL,
    role             TEXT    NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    failed_logins    INTEGER NOT NULL DEFAULT 0,
    locked_until     TEXT,
    is_frozen        INTEGER NOT NULL DEFAULT 0,
    session_version  INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login_at    TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_number  TEXT    NOT NULL UNIQUE,
    kind            TEXT    NOT NULL CHECK (kind IN ('checking', 'savings')),
    balance_cents   INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    from_account_id   INTEGER REFERENCES accounts(id),
    to_account_id     INTEGER REFERENCES accounts(id),
    amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
    memo              TEXT    NOT NULL DEFAULT '',
    kind              TEXT    NOT NULL CHECK (kind IN ('transfer', 'deposit')),
    idempotency_key   TEXT    UNIQUE,
    created_by        INTEGER NOT NULL REFERENCES users(id),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    event       TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    ip_address  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_account_id);
CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_account_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
