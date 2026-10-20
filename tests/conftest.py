import re

import pytest

from app import create_app
from app.config import TestConfig
from app.db import get_db
from app.security import limiter

STRONG = "Correct-Horse-9-Battery"


@pytest.fixture
def app(tmp_path):
    limiter.reset()
    app = create_app(TestConfig, DATABASE=str(tmp_path / "test.db"),
                     ADMIN_USERNAME="admin", ADMIN_PASSWORD="Admin-Pass-123!")
    yield app


@pytest.fixture
def client(app):
    return app.test_client()


def csrf(client, path="/login"):
    html = client.get(path).get_data(as_text=True)
    m = re.search(r'name="csrf_token" value="([^"]+)"', html)
    assert m, f"no csrf token on {path}"
    return m.group(1)


def form_value(client, path, name):
    html = client.get(path).get_data(as_text=True)
    m = re.search(rf'name="{name}" value="([^"]*)"', html)
    return m.group(1) if m else ""


def register(client, username="alice", full_name="Alice Walker", password=STRONG, email=None):
    token = csrf(client, "/register")
    return client.post("/register", data={
        "csrf_token": token, "full_name": full_name, "username": username,
        "email": email or f"{username}@example.com", "password": password, "confirm": password,
    })


def login(client, username="alice", password=STRONG, next_url=None):
    token = csrf(client, "/login")
    url = "/login" + (f"?next={next_url}" if next_url else "")
    return client.post(url, data={"csrf_token": token, "username": username, "password": password})


def logout(client):
    token = csrf(client, "/dashboard")
    return client.post("/logout", data={"csrf_token": token})


def accounts_of(app, username):
    with app.app_context():
        return {r["kind"]: dict(r) for r in get_db().execute(
            "SELECT a.* FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.username = ?", (username,))}


@pytest.fixture
def two_customers(app):
    """alice and bob, each registered. Returns separate logged-in clients."""
    a, b = app.test_client(), app.test_client()
    register(a, "alice", "Alice Walker"); login(a, "alice")
    register(b, "bob", "Bob Stone"); login(b, "bob")
    return a, b
