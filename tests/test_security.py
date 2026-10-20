import time

from conftest import csrf, login, register


def test_post_without_csrf_token_is_rejected(client):
    register(client)
    r = client.post("/login", data={"username": "alice", "password": "x"})
    assert r.status_code == 400


def test_post_with_wrong_csrf_token_is_rejected(client):
    csrf(client, "/login")
    r = client.post("/login", data={"csrf_token": "forged", "username": "a", "password": "b"})
    assert r.status_code == 400


def test_security_headers(client):
    r = client.get("/login")
    h = r.headers
    assert "default-src 'self'" in h["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in h["Content-Security-Policy"]
    assert h["X-Frame-Options"] == "DENY"
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["Referrer-Policy"] == "no-referrer"


def test_session_cookie_flags(client):
    register(client)
    r = login(client)
    cookie = [c for c in r.headers.getlist("Set-Cookie") if c.startswith("sb_session=")][0]
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie


def test_authenticated_pages_are_not_cached(client):
    register(client); login(client)
    assert client.get("/dashboard").headers["Cache-Control"] == "no-store"


def test_protected_routes_require_login(client):
    for path in ("/dashboard", "/transfer", "/activity", "/admin/"):
        r = client.get(path)
        assert r.status_code == 302 and "/login" in r.headers["Location"], path


def test_customer_cannot_open_admin(client):
    register(client); login(client)
    assert client.get("/admin/").status_code == 403


def test_admin_can_open_console_and_freeze_kicks_user_out(app):
    admin, alice = app.test_client(), app.test_client()
    register(alice); login(alice)
    login(admin, "admin", "Admin-Pass-123!")
    assert admin.get("/admin/").status_code == 200
    from app.db import get_db
    with app.app_context():
        uid = get_db().execute("SELECT id FROM users WHERE username='alice'").fetchone()[0]
    token = csrf(admin, "/admin/")
    admin.post(f"/admin/users/{uid}/freeze", data={"csrf_token": token})
    assert alice.get("/dashboard").status_code == 302  # signed out immediately
    assert "frozen" in login(alice).get_data(as_text=True)


def test_idle_timeout_signs_out(app, client):
    register(client); login(client)
    with client.session_transaction() as s:
        s["seen"] = int(time.time()) - app.config["IDLE_TIMEOUT_SECONDS"] - 5
    r = client.get("/dashboard")
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_sql_injection_in_login_is_inert(client):
    register(client)
    r = login(client, username="alice' OR '1'='1' --", password="anything")
    assert r.status_code == 401


def test_login_rate_limit(app, client):
    app.config["LOGIN_RATE_LIMIT"] = (3, 60)
    codes = [login(client, "nobody", "x").status_code for _ in range(4)]
    assert codes[:3] == [401, 401, 401] and codes[3] == 429


def test_oversized_body_rejected(client):
    token = csrf(client, "/login")
    r = client.post("/login", data={"csrf_token": token, "username": "a" * 20000, "password": "x"})
    assert r.status_code == 413
