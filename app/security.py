"""Security controls: CSRF, session validation, RBAC, rate limiting, validation, headers, audit."""
import hmac
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from decimal import Decimal, InvalidOperation
from functools import wraps

from flask import abort, current_app, flash, g, redirect, request, session, url_for

from .db import get_db

# --------------------------------------------------------------------------- audit

def client_ip() -> str:
    # Only trust X-Forwarded-For when deployed behind a known proxy (ProxyFix in create_app).
    return request.remote_addr or "unknown"


def audit(event: str, detail: str = "", user_id=None):
    db = get_db()
    uid = user_id if user_id is not None else (g.user["id"] if g.get("user") else None)
    db.execute(
        "INSERT INTO audit_log (user_id, event, detail, ip_address) VALUES (?, ?, ?, ?)",
        (uid, event, detail[:500], client_ip()),
    )

# --------------------------------------------------------------------------- CSRF

def csrf_token() -> str:
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def verify_csrf():
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    sent = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token", "")
    expected = session.get("csrf", "")
    if not expected or not hmac.compare_digest(sent, expected):
        audit("csrf_rejected", request.path)
        abort(400, description="Your form expired. Reload the page and try again.")

# --------------------------------------------------------------------------- sessions

def start_session(user):
    """Rotate the whole session on login to prevent session fixation."""
    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    session["ver"] = user["session_version"]
    session["seen"] = int(time.time())
    session["csrf"] = secrets.token_urlsafe(32)


def load_user():
    g.user = None
    uid = session.get("uid")
    if uid is None:
        return
    now = int(time.time())
    if now - session.get("seen", 0) > current_app.config["IDLE_TIMEOUT_SECONDS"]:
        session.clear()
        flash("You were signed out after 10 minutes of inactivity.", "info")
        return
    user = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    # session_version lets us revoke every cookie for a user server-side (logout, freeze, password change)
    if user is None or user["session_version"] != session.get("ver") or user["is_frozen"]:
        session.clear()
        return
    session["seen"] = now
    g.user = user


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("auth.login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def role_required(role):
    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            if g.user["role"] != role:
                audit("authz_denied", f"{request.method} {request.path}")
                abort(403)
            return view(*args, **kwargs)
        return wrapped
    return decorator

# --------------------------------------------------------------------------- rate limiting

class SlidingWindowLimiter:
    """In-memory limiter. Swap for Redis when running more than one worker process."""

    def __init__(self):
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: int) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()

# --------------------------------------------------------------------------- validation

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,24}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z .'\-]{1,59}$")
ACCOUNT_RE = re.compile(r"^SB\d{10}$")


class ValidationError(ValueError):
    pass


def password_problems(pw: str) -> list[str]:
    problems = []
    if len(pw) < 12:
        problems.append("at least 12 characters")
    if len(pw) > 128:
        problems.append("at most 128 characters")
    if not re.search(r"[a-z]", pw):
        problems.append("a lowercase letter")
    if not re.search(r"[A-Z]", pw):
        problems.append("an uppercase letter")
    if not re.search(r"\d", pw):
        problems.append("a number")
    if not re.search(r"[^A-Za-z0-9]", pw):
        problems.append("a symbol")
    return problems


def parse_amount(raw: str) -> int:
    """Convert user text like '1,250.50' to integer cents. Never use floats for money."""
    raw = (raw or "").replace(",", "").strip()
    if not re.fullmatch(r"\d{1,9}(\.\d{1,2})?", raw):
        raise ValidationError("Enter an amount like 250 or 250.75.")
    try:
        cents = int((Decimal(raw) * 100).to_integral_exact())
    except InvalidOperation:
        raise ValidationError("Enter an amount like 250 or 250.75.")
    if cents <= 0:
        raise ValidationError("Amount must be more than zero.")
    return cents


def clean_memo(raw: str) -> str:
    memo = (raw or "").strip()
    memo = re.sub(r"[\x00-\x1f\x7f]", "", memo)  # strip control chars
    if len(memo) > 80:
        raise ValidationError("Keep the note under 80 characters.")
    return memo

# --------------------------------------------------------------------------- headers

def set_security_headers(response):
    nonce = g.get("csp_nonce", "")
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        f"script-src 'self' 'nonce-{nonce}'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "object-src 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if current_app.config["SESSION_COOKIE_SECURE"]:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if g.get("user"):
        response.headers["Cache-Control"] = "no-store"  # never cache balances in the browser
    response.headers.pop("Server", None)
    return response


def fmt_money(cents: int) -> str:
    """Integer-only formatting so display never picks up float rounding."""
    sign = "-" if cents < 0 else ""
    cents = abs(int(cents))
    return f"{sign}{cents // 100:,}.{cents % 100:02d}"


def mask_name(full_name: str) -> str:
    parts = [p for p in full_name.split() if p]
    if not parts:
        return "Account holder"
    first = parts[0]
    rest = " ".join(p[0] + "." for p in parts[1:])
    return f"{first} {rest}".strip()
