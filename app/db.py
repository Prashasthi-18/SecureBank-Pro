"""SQLite access layer. Every query in the app uses parameter binding."""
import os
import secrets
import sqlite3

import click
from flask import current_app, g
from werkzeug.security import generate_password_hash


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        # isolation_level=None -> we control transactions explicitly (BEGIN IMMEDIATE)
        g.db = sqlite3.connect(current_app.config["DATABASE"], isolation_level=None)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA journal_mode = WAL")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    with current_app.open_resource("schema.sql") as f:
        db.executescript(f.read().decode("utf-8"))


def new_account_number(db) -> str:
    while True:
        number = "SB" + "".join(secrets.choice("0123456789") for _ in range(10))
        if not db.execute("SELECT 1 FROM accounts WHERE account_number = ?", (number,)).fetchone():
            return number


def create_user(db, username, email, full_name, password, role="customer", opening_cents=0):
    """Create a user plus a checking and savings account inside one transaction."""
    db.execute("BEGIN IMMEDIATE")
    try:
        cur = db.execute(
            "INSERT INTO users (username, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
            (username, email, full_name, generate_password_hash(password), role),
        )
        user_id = cur.lastrowid
        checking = db.execute(
            "INSERT INTO accounts (user_id, account_number, kind, balance_cents) VALUES (?, ?, 'checking', ?)",
            (user_id, new_account_number(db), opening_cents),
        ).lastrowid
        db.execute(
            "INSERT INTO accounts (user_id, account_number, kind, balance_cents) VALUES (?, ?, 'savings', 0)",
            (user_id, new_account_number(db)),
        )
        if opening_cents:
            db.execute(
                "INSERT INTO transactions (to_account_id, amount_cents, memo, kind, created_by) "
                "VALUES (?, ?, 'Welcome deposit', 'deposit', ?)",
                (checking, opening_cents, user_id),
            )
        db.execute("COMMIT")
        return user_id
    except Exception:
        db.execute("ROLLBACK")
        raise


def seed_admin():
    username = current_app.config.get("ADMIN_USERNAME")
    password = current_app.config.get("ADMIN_PASSWORD")
    if not username or not password:
        return
    db = get_db()
    if not db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        create_user(db, username, f"{username}@securebank.local", "Bank Administrator", password, role="admin")


@click.command("init-db")
def init_db_command():
    """Create tables (idempotent)."""
    init_db()
    seed_admin()
    click.echo("Database ready.")


def init_app(app):
    os.makedirs(os.path.dirname(app.config["DATABASE"]), exist_ok=True)
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
    with app.app_context():
        init_db()
        seed_admin()
