# SecureBank Pro

A security-focused banking application built with **Python, Flask, SQLite and Docker**, with an animated "vault" interface. Customers open accounts, move money between checking and savings or to other customers, and review their activity. Admins monitor an audit trail and can freeze accounts.

The point of the project is the security engineering: every control below is implemented in code and covered by an automated test.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                     # then edit SECRET_KEY / admin password
export $(grep -v '^#' .env | xargs)                      # or set the variables manually
python run.py                                            # http://127.0.0.1:5000
```

With Docker:

```bash
cp .env.example .env
docker compose up --build                                # http://localhost:8000
```

The container runs as a non-root user with a read-only filesystem, all Linux capabilities dropped and `no-new-privileges`. The database lives in a named volume.

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Prashasthi-18/SecureBank-Pro)

`render.yaml` defines the service: it builds the Dockerfile, generates `SECRET_KEY`, turns on secure cookies, HSTS and proxy-aware client IPs, and asks you for `ADMIN_PASSWORD` (leave it blank to skip the admin account). On the free plan the SQLite database lives inside the container, so accounts reset whenever the service restarts or redeploys. For lasting data, switch to a paid plan and attach a disk mounted at `/data`.

## Tests

```bash
pytest -m "not e2e"                  # 35 unit, security and transfer tests
playwright install chromium
pytest -m e2e                        # 4 Playwright browser tests
pytest --cov=app                     # coverage report
```

## Security controls

| Area | Control | Where | OWASP Top 10 (2021) |
|---|---|---|---|
| Passwords | Salted scrypt hashes; 12+ chars with mixed classes; can't contain username | `auth.py`, `security.py` | A02, A07 |
| Brute force | 5 failures locks the account 15 min; per-IP sliding-window rate limit on login, registration and recipient lookup | `auth.py`, `security.py` | A07 |
| User enumeration | Same error for unknown user and wrong password; dummy hash equalises response time; registration doesn't say whether the username or email was taken | `auth.py` | A07 |
| Sessions | HttpOnly, SameSite=Strict, Secure (when HTTPS), 15 min lifetime, 10 min idle timeout | `config.py`, `security.py` | A07 |
| Session fixation | Session fully cleared and re-issued on login | `security.start_session` | A07 |
| Session revocation | `session_version` column: logout or admin freeze bumps it, killing every copy of the cookie server-side | `security.load_user` | A07 |
| CSRF | Per-session token checked with constant-time compare on every POST | `security.verify_csrf` | A01 |
| Authorization | `login_required` and `role_required("admin")` decorators | `security.py`, `admin.py` | A01 |
| IDOR | Every account and receipt query is scoped to the signed-in owner; other users' receipts return 404, not 403 | `bank.py` | A01 |
| Open redirect | `?next=` only accepts same-site relative paths | `auth._safe_next` | A01 |
| Injection | 100% parameterised SQL | everywhere | A03 |
| XSS | Jinja autoescaping plus a strict CSP: no inline scripts or styles, `frame-ancestors 'none'`, `object-src 'none'` | `security.set_security_headers` | A03 |
| Money integrity | Integer cents (never floats); `BEGIN IMMEDIATE` write lock; debit uses `WHERE balance >= amount`; CHECK constraint forbids negative balances | `bank.transfer`, `schema.sql` | A04 |
| Double spend | Single-use idempotency key per form plus a UNIQUE constraint | `bank.transfer` | A04 |
| Business limits | 10,000.00 per transfer; 25,000.00 per day to other people | `config.py` | A04 |
| Input validation | Allow-list regexes for names, usernames, emails, account numbers, amounts; control characters stripped from notes; 16 KB body limit | `security.py` | A03, A04 |
| Headers | HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP; `Cache-Control: no-store` on signed-in pages | `security.py` | A05 |
| Logging | Audit log of sign-ins, failures, lockouts, transfers, CSRF rejections, authorization denials and admin actions, with IP | `audit_log` table | A09 |
| Container | Non-root, read-only root FS, caps dropped, healthcheck | `Dockerfile`, `docker-compose.yml` | A05 |

## Interface

A dark "Midnight" fintech design (Inter + Plus Jakarta Sans, indigo-to-cyan accents) built to feel polished and to be easy for first-time users. All motion switches off under `prefers-reduced-motion`.

**Made for new users**
- **Getting-started checklist** on the overview tracks four first steps (open account, copy your number, move to savings, send money) with a progress ring.
- **Guided tour**: a 30-second spotlight walkthrough of the dashboard (keyboard: arrows, Esc).
- **Guided sign-up**: a progress bar, live check marks on each field, plain-language hints, a password strength meter and show/hide password.
- **Three-step transfer**: pick a source, enter the recipient (their masked name is confirmed live), choose an amount with quick picks. "My savings" / "My checking" shortcuts handle moving between your own accounts. A live review panel shows who gets what and your balance afterwards.
- **Clear safety cues**: Caps Lock warning, "more than your balance" warnings, idle sign-out warning with a "Stay signed in" button.

**Motion**
- Drifting aurora background, cursor spotlight and grid, scroll progress bar, cross-page view transitions.
- Landing hero with word-by-word headline reveal, parallax dashboard mock-up, floating cards and count-up stats.
- Sign-in lock that reacts to typing, shakes on a wrong password and unlocks on submit; a welcome unlock animation after sign-in.
- Rolling odometer balances, a self-drawing balance chart with hover tooltip, 3D tilt cards with glare, sliding nav highlight, magnetic buttons and ripples.
- **Hold to send**: transfers need a one-second press (mouse, touch, or Space/Enter) with a filling progress ring, so a stray click can't move money.
- Receipts: the check mark draws, coins fly from sender to recipient and confetti bursts.
- Mobile gets a bottom tab bar with a raised Send button.

Everything runs under the strict CSP: no inline scripts or styles, and dynamic styling goes through the CSSOM.

## Project layout

```
app/
  __init__.py      app factory, error pages, request hooks
  config.py        environment-driven settings and limits
  db.py            SQLite connection, schema init, account creation
  schema.sql       tables, constraints, indexes
  security.py      CSRF, sessions, RBAC, rate limiter, validators, headers, audit
  auth.py          register, sign in, sign out
  bank.py          dashboard, transfers, receipts, activity, recipient lookup
  admin.py         admin console, freeze and unlock
  templates/       Jinja templates (icon sprite in _icons.html)
  static/          style.css, fx.js
tests/             pytest unit/security tests + Playwright E2E
```

## Known limits and next steps

- The rate limiter is in-memory, so the container runs one Gunicorn worker. For horizontal scaling, move it to Redis.
- SQLite fits a single node. PostgreSQL with row-level locks would be the production step.
- Natural extensions: TOTP two-factor, password change with session revocation, email alerts on new-device sign-ins, and scheduled transfers.
