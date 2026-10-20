import re

from conftest import accounts_of, csrf, form_value


def send(client, from_id, to_number, amount, memo=""):
    token = csrf(client, "/transfer")
    key = form_value(client, "/transfer", "idempotency_key")
    data = {"csrf_token": token, "idempotency_key": key, "from_account": str(from_id),
            "to_account": to_number, "amount": amount, "memo": memo}
    return client.post("/transfer", data=data), data


def test_transfer_moves_money_atomically(app, two_customers):
    alice, _ = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    r, _ = send(alice, a["checking"]["id"], b["checking"]["account_number"], "1250.50", "Rent share")
    assert r.status_code == 302 and "/transfers/" in r.headers["Location"]
    assert accounts_of(app, "alice")["checking"]["balance_cents"] == 500_000 - 125_050
    assert accounts_of(app, "bob")["checking"]["balance_cents"] == 500_000 + 125_050


def test_insufficient_funds_changes_nothing(app, two_customers):
    alice, _ = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    r, _ = send(alice, a["savings"]["id"], b["checking"]["account_number"], "10")
    assert "Not enough money" in r.get_data(as_text=True)
    assert accounts_of(app, "bob")["checking"]["balance_cents"] == 500_000


def test_invalid_amounts_rejected(app, two_customers):
    alice, _ = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    for bad in ("-5", "0", "abc", "1.999", "1e5", ""):
        r, _ = send(alice, a["checking"]["id"], b["checking"]["account_number"], bad)
        assert r.status_code == 200, bad
    assert accounts_of(app, "alice")["checking"]["balance_cents"] == 500_000


def test_cannot_spend_from_someone_elses_account(app, two_customers):
    """IDOR: alice submits bob's account id as the source."""
    alice, _ = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    r, _ = send(alice, b["checking"]["id"], a["checking"]["account_number"], "100")
    assert "Choose one of your accounts" in r.get_data(as_text=True)
    assert accounts_of(app, "bob")["checking"]["balance_cents"] == 500_000


def test_cannot_view_someone_elses_receipt(app, two_customers):
    alice, bob = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    r, _ = send(bob, b["checking"]["id"], b["savings"]["account_number"], "5")
    tx_id = re.search(r"/transfers/(\d+)", r.headers["Location"]).group(1)
    assert bob.get(f"/transfers/{tx_id}").status_code == 200
    assert alice.get(f"/transfers/{tx_id}").status_code == 404


def test_replayed_form_does_not_pay_twice(app, two_customers):
    alice, _ = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    r, data = send(alice, a["checking"]["id"], b["checking"]["account_number"], "100")
    assert r.status_code == 302
    data["csrf_token"] = csrf(alice, "/dashboard")
    replay = alice.post("/transfer", data=data)
    assert "already submitted" in replay.get_data(as_text=True)
    assert accounts_of(app, "bob")["checking"]["balance_cents"] == 510_000


def test_single_transfer_cap(app, two_customers):
    alice, _ = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    r, _ = send(alice, a["checking"]["id"], b["checking"]["account_number"], "10000.01")
    assert "capped" in r.get_data(as_text=True)


def test_daily_limit_applies_to_external_only(app, two_customers):
    alice, bob = two_customers
    app.config["DAILY_TRANSFER_LIMIT_CENTS"] = 50_000  # 500.00
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    assert send(alice, a["checking"]["id"], b["checking"]["account_number"], "400")[0].status_code == 302
    r, _ = send(alice, a["checking"]["id"], b["checking"]["account_number"], "200")
    assert "daily limit" in r.get_data(as_text=True)
    # Moving money into your own savings is not limited
    assert send(alice, a["checking"]["id"], a["savings"]["account_number"], "2000")[0].status_code == 302


def test_cannot_send_to_same_account(app, two_customers):
    alice, _ = two_customers
    a = accounts_of(app, "alice")
    r, _ = send(alice, a["checking"]["id"], a["checking"]["account_number"], "5")
    assert "different account" in r.get_data(as_text=True)


def test_memo_is_html_escaped_on_receipt(app, two_customers):
    alice, bob = two_customers
    a, b = accounts_of(app, "alice"), accounts_of(app, "bob")
    r, _ = send(alice, a["checking"]["id"], b["checking"]["account_number"], "1", "<script>alert(1)</script>")
    page = bob.get(r.headers["Location"]).get_data(as_text=True)
    assert "<script>alert(1)</script>" not in page
    assert "&lt;script&gt;" in page


def test_lookup_returns_masked_name(app, two_customers):
    alice, _ = two_customers
    b = accounts_of(app, "bob")
    data = alice.get(f"/api/lookup?account={b['checking']['account_number']}").get_json()
    assert data["name"] == "Bob S." and data["own"] is False
    assert alice.get("/api/lookup?account=nope").status_code == 400
