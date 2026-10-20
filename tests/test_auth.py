from conftest import STRONG, accounts_of, csrf, login, logout, register


def test_register_opens_two_accounts_with_welcome_deposit(app, client):
    r = register(client)
    assert r.status_code == 302 and r.headers["Location"].endswith("/login")
    accts = accounts_of(app, "alice")
    assert set(accts) == {"checking", "savings"}
    assert accts["checking"]["balance_cents"] == 500_000
    assert accts["savings"]["balance_cents"] == 0


def test_password_is_hashed_not_stored(app, client):
    register(client)
    from app.db import get_db
    with app.app_context():
        h = get_db().execute("SELECT password_hash FROM users WHERE username='alice'").fetchone()[0]
    assert STRONG not in h and h.startswith(("scrypt:", "pbkdf2:"))


def test_weak_password_rejected(client):
    r = register(client, password="short")
    assert r.status_code == 200
    assert "Password needs" in r.get_data(as_text=True)


def test_duplicate_username_rejected_without_revealing_which(client):
    register(client)
    r = register(client, email="other@example.com")
    assert "already registered" in r.get_data(as_text=True)


def test_login_success_redirects_to_dashboard(client):
    register(client)
    r = login(client)
    assert r.status_code == 302 and r.headers["Location"].endswith("/dashboard")
    assert client.get("/dashboard").status_code == 200


def test_wrong_password_and_unknown_user_give_same_message(client):
    register(client)
    wrong = login(client, password="Nope-Nope-123!").get_data(as_text=True)
    ghost = login(client, username="ghost").get_data(as_text=True)
    msg = "Username or password is incorrect."
    assert msg in wrong and msg in ghost


def test_account_locks_after_five_failures(client):
    register(client)
    for _ in range(5):
        assert login(client, password="Wrong-Pass-123!").status_code == 401
    r = login(client)  # correct password, but locked
    assert r.status_code == 401
    assert "locked" in r.get_data(as_text=True)


def test_session_rotates_on_login(client):
    register(client)
    client.get("/login")
    before = client.get_cookie("sb_session").value
    login(client)
    after = client.get_cookie("sb_session").value
    assert before != after


def test_logout_revokes_stolen_cookie(app, client):
    register(client); login(client)
    stolen = client.get_cookie("sb_session").value
    logout(client)
    attacker = app.test_client()
    attacker.set_cookie("sb_session", stolen)
    r = attacker.get("/dashboard")
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_open_redirect_blocked(client):
    register(client)
    r = login(client, next_url="//evil.example/phish")
    assert r.headers["Location"].endswith("/dashboard")


def test_safe_next_redirect_allowed(client):
    register(client)
    r = login(client, next_url="/activity")
    assert r.headers["Location"].endswith("/activity")


def test_logout_requires_post(client):
    register(client); login(client)
    assert client.get("/logout").status_code == 405
