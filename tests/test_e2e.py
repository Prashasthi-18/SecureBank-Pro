"""Browser end-to-end tests with Playwright (sync API).

Run:  pip install playwright && playwright install chromium
      pytest -m e2e
"""
import re
import threading

import pytest

playwright = pytest.importorskip("playwright.sync_api")
expect = playwright.expect
from werkzeug.serving import make_server  # noqa: E402

from app import create_app  # noqa: E402
from app.config import TestConfig  # noqa: E402
from app.security import limiter  # noqa: E402

pytestmark = pytest.mark.e2e
PASSWORD = "Strong-Pass-2026!"


@pytest.fixture(scope="module")
def base_url(tmp_path_factory):
    limiter.reset()
    app = create_app(TestConfig, DATABASE=str(tmp_path_factory.mktemp("e2e") / "e2e.db"))
    server = make_server("127.0.0.1", 0, app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(reduced_motion="no-preference")
    pg = ctx.new_page()
    pg.csp_violations = []
    pg.on("console", lambda m: "Content Security Policy" in m.text and pg.csp_violations.append(m.text))
    yield pg
    ctx.close()


def open_account(page, base_url, username, name):
    page.goto(f"{base_url}/register")
    page.get_by_label("Full name").fill(name)
    page.get_by_label("Username").fill(username)
    page.get_by_label("Email").fill(f"{username}@example.com")
    page.get_by_label("Password", exact=True).fill(PASSWORD)
    page.get_by_label("Confirm password").fill(PASSWORD)
    page.get_by_role("button", name="Open account").click()
    page.wait_for_url(re.compile(r"/login$"))


def sign_in(page, base_url, username):
    page.goto(f"{base_url}/login")
    page.get_by_label("Username").fill(username)
    page.get_by_label("Password", exact=True).fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(re.compile(r"/dashboard$"))


def test_strength_meter_tracks_rules(page, base_url):
    page.goto(f"{base_url}/register")
    pw = page.get_by_label("Password", exact=True)
    pw.fill("abc")
    assert page.locator(".strength-rules li.ok").count() == 1
    pw.fill(PASSWORD)
    assert page.locator(".strength-rules li.ok").count() == 5


def test_hold_to_send_transfer_end_to_end(page, browser, base_url):
    open_account(page, base_url, "erin", "Erin Cole")
    other = browser.new_page()
    open_account(other, base_url, "fred", "Fred Hale")
    sign_in(other, base_url, "fred")
    fred_number = other.locator("[data-copy]").first.get_attribute("data-copy")
    other.close()

    sign_in(page, base_url, "erin")
    page.get_by_role("link", name="Send money").first.click()
    page.get_by_label("To account number").fill(fred_number)
    page.get_by_label("Amount").fill("320.40")
    page.get_by_label("Note for the recipient").fill("Concert tickets")
    expect(page.locator("[data-lookup-result]")).to_contain_text("Fred H.")

    # A quick click must NOT send money
    page.locator("[data-hold]").click()
    page.wait_for_timeout(400)
    assert "/transfer" in page.url

    # A one-second hold does
    page.locator("[data-hold]").scroll_into_view_if_needed()
    box = page.locator("[data-hold]").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_url(re.compile(r"/transfers/\d+$"), timeout=4000)
    page.mouse.up()
    expect(page.get_by_role("heading", name="Sent")).to_be_visible()
    expect(page.locator(".receipt-amount")).to_have_attribute("aria-label", "320.40")
    assert page.csp_violations == []


def test_wrong_password_shows_error_and_stays_on_login(page, base_url):
    open_account(page, base_url, "gina", "Gina Park")
    page.goto(f"{base_url}/login")
    page.get_by_label("Username").fill("gina")
    page.get_by_label("Password", exact=True).fill("Wrong-Pass-000!")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_load_state()
    expect(page.get_by_role("alert")).to_have_text("Username or password is incorrect.")


def test_move_to_savings_shortcut(page, base_url):
    open_account(page, base_url, "hana", "Hana Lee")
    sign_in(page, base_url, "hana")
    page.get_by_role("link", name="Move to savings").click()
    page.wait_for_url(re.compile(r"/transfer\?to=SB\d{10}$"))
    expect(page.locator("[data-lookup-result]")).to_contain_text("(yours)")
    page.get_by_label("Amount").fill("75")
    page.locator("[data-hold]").scroll_into_view_if_needed()
    box = page.locator("[data-hold]").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_url(re.compile(r"/transfers/\d+$"), timeout=4000)
    page.mouse.up()
    expect(page.get_by_role("heading", name="Moved")).to_be_visible()
    assert page.csp_violations == []
