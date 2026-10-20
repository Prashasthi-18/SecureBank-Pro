"""Accounts, transfers and activity. Every query is scoped to the signed-in user (no IDOR)."""
import secrets
import sqlite3

from flask import Blueprint, abort, current_app, flash, g, jsonify, redirect, render_template, request, session, url_for

from .db import get_db
from .security import (ACCOUNT_RE, ValidationError, audit, clean_memo, fmt_money, limiter, login_required,
                       mask_name, parse_amount)

bp = Blueprint("bank", __name__)

TX_SELECT = """
    SELECT t.*, fa.account_number AS from_number, ta.account_number AS to_number,
           fu.full_name AS from_name, tu.full_name AS to_name,
           fa.user_id AS from_user, ta.user_id AS to_user,
           fa.kind AS from_kind, ta.kind AS to_kind
    FROM transactions t
    LEFT JOIN accounts fa ON fa.id = t.from_account_id
    LEFT JOIN accounts ta ON ta.id = t.to_account_id
    LEFT JOIN users fu ON fu.id = fa.user_id
    LEFT JOIN users tu ON tu.id = ta.user_id
"""


def my_accounts():
    return get_db().execute(
        "SELECT * FROM accounts WHERE user_id = ? ORDER BY kind", (g.user["id"],)
    ).fetchall()


def present_tx(row, uid):
    """Shape a transaction from the signed-in user's point of view."""
    outgoing = row["from_user"] == uid
    incoming = row["to_user"] == uid
    internal = outgoing and incoming
    if row["kind"] == "deposit":
        title, sign = "Deposit", 1
    elif internal:
        title, sign = "Moved between your accounts", 0
    elif outgoing:
        title, sign = f"To {mask_name(row['to_name'])}", -1
    else:
        title, sign = f"From {mask_name(row['from_name'])}", 1
    return {
        "id": row["id"], "title": title, "memo": row["memo"], "sign": sign,
        "amount_cents": row["amount_cents"], "created_at": row["created_at"],
    }


def recent_activity(account_ids, limit, offset=0):
    if not account_ids:
        return []
    marks = ",".join("?" * len(account_ids))
    return get_db().execute(
        f"{TX_SELECT} WHERE t.from_account_id IN ({marks}) OR t.to_account_id IN ({marks}) "
        "ORDER BY t.id DESC LIMIT ? OFFSET ?",
        (*account_ids, *account_ids, limit, offset),
    ).fetchall()


@bp.route("/dashboard")
@login_required
def dashboard():
    accounts = my_accounts()
    ids = [a["id"] for a in accounts]
    total = sum(a["balance_cents"] for a in accounts)
    rows = recent_activity(ids, 30)
    activity = [present_tx(r, g.user["id"]) for r in rows]

    # Walk backwards from today's total to build a balance history for the sparkline.
    history, running = [total], total
    for tx in activity:
        running -= tx["sign"] * tx["amount_cents"]
        history.append(running)
    history.reverse()

    intro = session.pop("intro", False)
    return render_template("dashboard.html", accounts=accounts, total=total, intro=intro,
                           activity=activity[:8], history=",".join(str(h) for h in history[-20:]))


@bp.route("/activity")
@login_required
def activity():
    page = max(1, min(request.args.get("page", 1, type=int), 1000))
    per = 15
    ids = [a["id"] for a in my_accounts()]
    rows = recent_activity(ids, per + 1, (page - 1) * per)
    items = [present_tx(r, g.user["id"]) for r in rows[:per]]
    return render_template("activity.html", items=items, page=page, has_next=len(rows) > per)


@bp.route("/api/lookup")
@login_required
def lookup():
    """Confirm a recipient before sending. Rate limited because it reveals masked names."""
    if not limiter.allow(f"lookup:{g.user['id']}", 20, 60):
        return jsonify(error="Too many lookups. Wait a minute."), 429
    number = (request.args.get("account") or "").strip().upper()
    if not ACCOUNT_RE.fullmatch(number):
        return jsonify(error="Account numbers look like SB0123456789."), 400
    row = get_db().execute(
        "SELECT a.kind, a.user_id, u.full_name, u.is_frozen FROM accounts a JOIN users u ON u.id = a.user_id "
        "WHERE a.account_number = ?", (number,)
    ).fetchone()
    if not row or row["is_frozen"]:
        return jsonify(error="No open account with that number."), 404
    return jsonify(name=mask_name(row["full_name"]), kind=row["kind"], own=row["user_id"] == g.user["id"])


@bp.route("/transfer", methods=["GET", "POST"])
@login_required
def transfer():
    accounts = my_accounts()
    errors, form = {}, {}

    if request.method == "POST":
        form = {k: (request.form.get(k) or "").strip() for k in ("from_account", "to_account", "amount", "memo")}
        key = request.form.get("idempotency_key", "")
        db = get_db()
        cfg = current_app.config

        # Ownership check: the source account must belong to the signed-in user.
        source = next((a for a in accounts if str(a["id"]) == form["from_account"]), None)
        if source is None:
            audit("transfer_idor_blocked", f"from_account={form['from_account'][:20]}")
            errors["from_account"] = "Choose one of your accounts."

        to_number = form["to_account"].upper()
        target = None
        if not ACCOUNT_RE.fullmatch(to_number):
            errors["to_account"] = "Account numbers look like SB0123456789."
        else:
            target = db.execute(
                "SELECT a.*, u.is_frozen FROM accounts a JOIN users u ON u.id = a.user_id WHERE account_number = ?",
                (to_number,)).fetchone()
            if target is None or target["is_frozen"]:
                errors["to_account"] = "No open account with that number."
            elif source is not None and target["id"] == source["id"]:
                errors["to_account"] = "Pick a different account from the one you're sending from."

        try:
            amount = parse_amount(form["amount"])
            if amount > cfg["MAX_TRANSFER_CENTS"]:
                raise ValidationError(f"Single transfers are capped at {fmt_money(cfg['MAX_TRANSFER_CENTS'])}.")
        except ValidationError as e:
            errors["amount"], amount = str(e), 0

        try:
            memo = clean_memo(form["memo"])
        except ValidationError as e:
            errors["memo"], memo = str(e), ""

        if not key or len(key) > 64 or key != session.get("transfer_key"):
            errors["form"] = "This form was already submitted or has expired. Check your activity before retrying."

        if not errors:
            try:
                db.execute("BEGIN IMMEDIATE")  # lock the DB for writes: no race between check and debit
                sent_today = db.execute(
                    "SELECT COALESCE(SUM(t.amount_cents), 0) FROM transactions t JOIN accounts a ON a.id = t.from_account_id "
                    "LEFT JOIN accounts b ON b.id = t.to_account_id "
                    "WHERE a.user_id = ? AND (b.user_id IS NULL OR b.user_id != a.user_id) "
                    "AND t.created_at >= datetime('now', 'start of day')",
                    (g.user["id"],)).fetchone()[0]
                external = target["user_id"] != g.user["id"]
                if external and sent_today + amount > cfg["DAILY_TRANSFER_LIMIT_CENTS"]:
                    raise ValidationError(
                        f"This would pass your daily limit of {fmt_money(cfg['DAILY_TRANSFER_LIMIT_CENTS'])}. "
                        f"You can still send {fmt_money(max(0, cfg['DAILY_TRANSFER_LIMIT_CENTS'] - sent_today))} today.")
                debited = db.execute(
                    "UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ? AND user_id = ? AND balance_cents >= ?",
                    (amount, source["id"], g.user["id"], amount)).rowcount
                if debited != 1:
                    raise ValidationError(f"Not enough money in {source['kind']}. Available: {fmt_money(source['balance_cents'])}.")
                db.execute("UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?", (amount, target["id"]))
                tx_id = db.execute(
                    "INSERT INTO transactions (from_account_id, to_account_id, amount_cents, memo, kind, idempotency_key, created_by) "
                    "VALUES (?, ?, ?, ?, 'transfer', ?, ?)",
                    (source["id"], target["id"], amount, memo, key, g.user["id"])).lastrowid
                db.execute("COMMIT")
            except ValidationError as e:
                db.execute("ROLLBACK")
                errors["amount"] = str(e)
            except sqlite3.IntegrityError:
                db.execute("ROLLBACK")
                errors["form"] = "This transfer was already processed. Check your activity."
            else:
                session.pop("transfer_key", None)
                audit("transfer", f"tx={tx_id} amount={amount} to={to_number}")
                return redirect(url_for("bank.receipt", tx_id=tx_id))

        if errors:
            audit("transfer_rejected", "; ".join(f"{k}" for k in errors))

    session["transfer_key"] = secrets.token_urlsafe(24)
    return render_template("transfer.html", accounts=accounts, errors=errors, form=form,
                           idempotency_key=session["transfer_key"])


@bp.route("/transfers/<int:tx_id>")
@login_required
def receipt(tx_id):
    row = get_db().execute(f"{TX_SELECT} WHERE t.id = ?", (tx_id,)).fetchone()
    # Return 404 (not 403) for other people's receipts so IDs can't be probed.
    if row is None or g.user["id"] not in (row["from_user"], row["to_user"]):
        abort(404)
    tx = present_tx(row, g.user["id"])
    return render_template("receipt.html", tx=tx, row=row)
