"""Admin console: role-gated user management and audit trail."""
from flask import Blueprint, abort, flash, g, redirect, render_template, url_for

from .db import get_db
from .security import audit, role_required

bp = Blueprint("admin", __name__, url_prefix="/admin")


@bp.route("/")
@role_required("admin")
def console():
    db = get_db()
    users = db.execute(
        "SELECT u.id, u.username, u.full_name, u.role, u.is_frozen, u.locked_until, u.last_login_at, "
        "COALESCE(SUM(a.balance_cents), 0) AS total FROM users u LEFT JOIN accounts a ON a.user_id = u.id "
        "GROUP BY u.id ORDER BY u.id"
    ).fetchall()
    events = db.execute(
        "SELECT l.*, u.username FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 60"
    ).fetchall()
    stats = {
        "users": len(users),
        "deposits": sum(u["total"] for u in users),
        "failed_24h": db.execute("SELECT COUNT(*) FROM audit_log WHERE event = 'login_failed' "
                                 "AND created_at >= datetime('now', '-1 day')").fetchone()[0],
        "blocked_24h": db.execute("SELECT COUNT(*) FROM audit_log WHERE event IN "
                                  "('csrf_rejected','authz_denied','transfer_idor_blocked','login_rate_limited','account_locked') "
                                  "AND created_at >= datetime('now', '-1 day')").fetchone()[0],
    }
    return render_template("admin.html", users=users, events=events, stats=stats)


def _target(user_id):
    user = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        abort(404)
    if user["id"] == g.user["id"]:
        flash("You can't change your own access from the console.", "error")
        return None
    return user


@bp.route("/users/<int:user_id>/freeze", methods=["POST"])
@role_required("admin")
def toggle_freeze(user_id):
    user = _target(user_id)
    if user:
        frozen = 0 if user["is_frozen"] else 1
        # Freezing also bumps session_version so the user is kicked out immediately.
        get_db().execute("UPDATE users SET is_frozen = ?, session_version = session_version + 1 WHERE id = ?",
                         (frozen, user_id))
        audit("admin_freeze" if frozen else "admin_unfreeze", user["username"])
        flash(f"{user['username']} {'frozen and signed out' if frozen else 'unfrozen'}.", "success")
    return redirect(url_for("admin.console"))


@bp.route("/users/<int:user_id>/unlock", methods=["POST"])
@role_required("admin")
def unlock(user_id):
    user = _target(user_id)
    if user:
        get_db().execute("UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE id = ?", (user_id,))
        audit("admin_unlock", user["username"])
        flash(f"{user['username']} can sign in again.", "success")
    return redirect(url_for("admin.console"))
