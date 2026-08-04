"""End-to-end subscription refund and entitlement integrity."""
from __future__ import annotations

from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core import config as cfg
from app.core.timeutil import utc_now
from app.db.session import init_db
from app.main import app
from app.models.entities import Subscription, SubscriptionStatus
from app.models.subscription_checkout import SubscriptionCheckout, SubscriptionRefund
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "subscription_refund.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setattr(cfg.settings, "database_url", url)
    monkeypatch.setattr(cfg.settings, "environment", "development")
    monkeypatch.setattr(cfg.settings, "yookassa_shop_id", None)
    monkeypatch.setattr(cfg.settings, "yookassa_secret", None)
    monkeypatch.setattr(cfg.settings, "yookassa_webhook_secret", None)
    monkeypatch.setattr(cfg.settings, "public_base_url", "http://127.0.0.1:8081")

    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)
    yield
    await sess.engine.dispose()


async def _contractor(client: AsyncClient):
    response = await client.post("/api/v1/auth/demo", json={"role": "contractor"})
    assert response.status_code == 200, response.text
    user = response.json()
    return user, {"X-User-Id": user["id"]}


async def _checkout(client: AsyncClient, headers: dict[str, str], *, new_cycle: bool = False):
    response = await client.post(
        "/api/v1/subscription/checkout",
        headers=headers,
        json={"new_cycle": new_cycle},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _refund(
    client: AsyncClient,
    *,
    refund_id: str,
    payment_id: str,
    amount: str,
):
    return await client.post(
        "/api/v1/subscription/webhook",
        json={
            "event": "refund.succeeded",
            "object": {
                "id": refund_id,
                "payment_id": payment_id,
                "status": "succeeded",
                "amount": {"value": amount, "currency": "RUB"},
            },
        },
    )


async def _subscription(user_id: str) -> Subscription:
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        return (
            await db.execute(select(Subscription).where(Subscription.user_id == user_id))
        ).scalar_one()


async def test_full_refund_restores_free_entitlement_and_is_replay_safe():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)
        purchase = await _checkout(client, headers)
        refunded = await _refund(
            client,
            refund_id="yk-refund-full",
            payment_id=purchase["payment_id"],
            amount="990.00",
        )
        replay = await _refund(
            client,
            refund_id="yk-refund-full",
            payment_id=purchase["payment_id"],
            amount="990.00",
        )

    assert refunded.status_code == 200, refunded.text
    assert refunded.json()["business_applied"] is True
    assert refunded.json()["changed"] is True
    assert refunded.json()["partial"] is False
    assert replay.status_code == 200, replay.text
    assert replay.json()["duplicate"] is True
    assert replay.json()["business_applied"] is False

    subscription = await _subscription(user["id"])
    assert subscription.status == SubscriptionStatus.free
    assert subscription.plan == "free"
    assert subscription.expires_at is None

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        checkout = await db.get(SubscriptionCheckout, purchase["checkout_id"])
        assert checkout is not None
        assert checkout.status == "refunded"
        assert checkout.refunded_amount == 990
        assert checkout.entitlement_reversed_at is not None
        refunds = (
            await db.execute(
                select(SubscriptionRefund).where(
                    SubscriptionRefund.checkout_id == checkout.id
                )
            )
        ).scalars().all()
        assert len(refunds) == 1
        assert refunds[0].status == "applied"
        assert refunds[0].entitlement_changed is True


async def test_partial_refunds_accumulate_before_entitlement_is_revoked():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)
        purchase = await _checkout(client, headers)
        first = await _refund(
            client,
            refund_id="yk-refund-part-1",
            payment_id=purchase["payment_id"],
            amount="400.00",
        )
        active_after_partial = await client.get("/api/v1/subscription/me", headers=headers)
        second = await _refund(
            client,
            refund_id="yk-refund-part-2",
            payment_id=purchase["payment_id"],
            amount="590.00",
        )

    assert first.status_code == 200, first.text
    assert first.json()["partial"] is True
    assert first.json()["changed"] is False
    assert first.json()["cumulative_amount"] == 400
    assert active_after_partial.status_code == 200
    assert active_after_partial.json()["is_pro"] is True
    assert second.status_code == 200, second.text
    assert second.json()["partial"] is False, second.text
    assert second.json()["changed"] is True, second.text
    assert second.json()["cumulative_amount"] == 990, second.text

    subscription = await _subscription(user["id"])
    assert subscription.status == SubscriptionStatus.free


async def test_refunding_older_of_two_renewals_preserves_newer_month():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)
        first = await _checkout(client, headers)
        second = await _checkout(client, headers, new_cycle=True)
        response = await _refund(
            client,
            refund_id="yk-refund-first-of-two",
            payment_id=first["payment_id"],
            amount="990.00",
        )

    assert response.status_code == 200, response.text
    assert response.json()["changed"] is True, response.text
    subscription = await _subscription(user["id"])
    assert subscription.status == SubscriptionStatus.active
    assert subscription.plan == "pro"
    assert subscription.expires_at is not None
    remaining = subscription.expires_at - utc_now()
    assert timedelta(days=29, hours=23) < remaining < timedelta(days=30, minutes=1)

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        newer = await db.get(SubscriptionCheckout, second["checkout_id"])
        assert newer is not None
        assert newer.status == "succeeded"


async def test_refund_restores_active_trial_baseline():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)
        trial = await client.post("/api/v1/subscription/start-trial", headers=headers)
        assert trial.status_code == 200, trial.text
        trial_before = await _subscription(user["id"])
        assert trial_before.plan == "trial"
        trial_expiry = trial_before.expires_at
        purchase = await _checkout(client, headers)
        response = await _refund(
            client,
            refund_id="yk-refund-trial-baseline",
            payment_id=purchase["payment_id"],
            amount="990.00",
        )

    assert response.status_code == 200, response.text
    restored = await _subscription(user["id"])
    assert restored.status == SubscriptionStatus.active
    assert restored.plan == "trial"
    assert restored.expires_at == trial_expiry


async def test_unknown_legacy_refund_is_durable_review_not_retry_loop():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await _refund(
            client,
            refund_id="yk-refund-legacy-unknown",
            payment_id="yk-payment-before-checkout-ledger",
            amount="990.00",
        )
        replay = await _refund(
            client,
            refund_id="yk-refund-legacy-unknown",
            payment_id="yk-payment-before-checkout-ledger",
            amount="990.00",
        )

    assert first.status_code == 200, first.text
    assert first.json()["business_applied"] is True
    assert first.json()["manual_review"] is True
    assert first.json()["reason"] == "legacy_or_unknown_subscription_payment"
    assert replay.status_code == 200, replay.text
    assert replay.json()["duplicate"] is True

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        rows = (
            await db.execute(
                select(SubscriptionRefund).where(
                    SubscriptionRefund.provider_refund_id
                    == "yk-refund-legacy-unknown"
                )
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].status == "manual_review"
        assert rows[0].checkout_id is None
