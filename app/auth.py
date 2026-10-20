"""Registration, login, logout."""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from flask import Blueprint, abort, current_app, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from .db import create_user, get_db
from .security import (EMAIL_RE, NAME_RE, USERNAME_RE, audit, client_ip, limiter, password_problems,
                       start_session)

bp = Blueprint("auth", __name__)

# Hash a throwaway password once so unknown usernames cost the same time as real ones.
_DUMMY_HASH = generate_password_hash("timing-equaliser-not-a-real-password")


def _utcnow():
    return datetime.now(timezone.utc).replace(microsecond=0)


def _safe_next(target: str | None) -> str:
    """Only allow same-site relative redirects (blocks open redirects like //evil.com)."""
    if not target:
        return url_for("bank.dashboard")
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc or not target.startswith("/") or target.startswith("//"):
        return url_for("bank.dashboard")
    return target


@bp.route("/")
def landing():
    if g.user:
        return redirect(url_for("bank.dashboard"))
    return render_template("landing.html")


@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("bank.dashboard"))
    errors, form = {}, {}
    if request.method == "POST":
        if not limiter.allow(f"register:{client_ip()}", 5, 300):
            abort(429)
        form = {k: (request.form.get(k) or "").strip() for k in ("full_name", "username", "email")}
        password = request.form.get("password") or ""
        confirm = request.form.get("confirm") or ""

        if not NAME_RE.fullmatch(form["full_name"]):
            errors["full_name"] = "Use 2–60 letters, spaces, apostrophes or hyphens."
        if not USERNAME_RE.fullmatch(form["username"]):
            errors["username"] = "Use 3–24 letters, numbers or underscores."
        if not EMAIL_RE.fullmatch(form["email"]):
            errors["email"] = "Enter an email like name@example.com."
        problems = password_problems(password)
        if problems:
            errors["password"] = "Password needs " + ", ".join(problems) + "."
        elif form["username"] and form["username"].lower() in password.lower():
            errors["password"] = "Password can't contain your username."
        if password != confirm:
            errors["confirm"] = "Passwords don't match."

        db = get_db()
        if not errors:
            taken = db.execute(
                "SELECT username, email FROM users WHERE username = ? OR email = ?",
                (form["username"], form["email"]),
            ).fetchone()
            if taken:
                # Same message for both so the form can't be used to probe which emails exist.
                errors["username"] = "That username or email is already registered."

        if not errors:
            uid = create_user(db, form["username"], form["email"], form["full_name"], password,
                              opening_cents=current_app.config["OPENING_BONUS_CENTS"])
            audit("register", form["username"], user_id=uid)
            flash("Account opened with a 5,000.00 welcome deposit. Sign in to continue.", "success")
            return redirect(url_for("auth.login"))

    return render_template("register.html", errors=errors, form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("bank.dashboard"))
    error = None
    if request.method == "POST":
        limit, window = current_app.config["LOGIN_RATE_LIMIT"]
        if not limiter.allow(f"login:{client_ip()}", limit, window):
            audit("login_rate_limited", request.form.get("username", "")[:40])
            abort(429)

        username = (request.form.get("username") or "").strip()[:64]
        password = (request.form.get("password") or "")[:128]
        db = get_db()
        user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        now = _utcnow()

        if user is None:
            check_password_hash(_DUMMY_HASH, password)
            audit("login_failed", f"unknown user {username!r}")
            error = "Username or password is incorrect."
        elif user["locked_until"] and datetime.fromisoformat(user["locked_until"]) > now:
            minutes = int((datetime.fromisoformat(user["locked_until"]) - now).total_seconds() // 60) + 1
            audit("login_locked", username, user_id=user["id"])
            error = f"This account is locked after repeated failed sign-ins. Try again in {minutes} min."
        elif user["is_frozen"]:
            audit("login_frozen", username, user_id=user["id"])
            error = "This account is frozen. Contact support to restore access."
        elif not check_password_hash(user["password_hash"], password):
            failed = user["failed_logins"] + 1
            if failed >= current_app.config["MAX_FAILED_LOGINS"]:
                until = now + timedelta(minutes=current_app.config["LOCKOUT_MINUTES"])
                db.execute("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?",
                           (until.isoformat(), user["id"]))
                audit("account_locked", f"after {failed} failures", user_id=user["id"])
            else:
                db.execute("UPDATE users SET failed_logins = ? WHERE id = ?", (failed, user["id"]))
            audit("login_failed", username, user_id=user["id"])
            error = "Username or password is incorrect."
        else:
            db.execute("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
                       (now.isoformat(), user["id"]))
            start_session(user)
            session["intro"] = True  # play the vault-opening sequence once on the dashboard
            audit("login_success", "", user_id=user["id"])
            return redirect(_safe_next(request.args.get("next")))

    return render_template("login.html", error=error), (401 if error else 200)


@bp.route("/logout", methods=["POST"])
def logout():
    if g.user:
        # Bumping the version invalidates this cookie and any copies of it, everywhere.
        get_db().execute("UPDATE users SET session_version = session_version + 1 WHERE id = ?", (g.user["id"],))
        audit("logout")
    session.clear()
    flash("Signed out. Your vault is locked.", "info")
    return redirect(url_for("auth.login"))
