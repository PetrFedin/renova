"""End-to-end Renova Pro renewal lifecycle integrity."""
from __future__ import annotations

from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core import config as cfg
from app.core.timeutil import utc_now
from app.db.session import init_db
from app.main import app
from app.models.entities import Subscription, User, UserRole
from app.models.subscription_checkout import SubscriptionCheckout
from app.services import subscription_checkout_service as checkout_svc
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "subscription_renewal.db"
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


async def _subscription(user_id: str) -> Subscription:
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        row = (
            await db.execute(select(Subscription).where(Subscription.user_id == user_id))
        ).scalar_one()
        return row


async def _checkout(checkout_id: str) -> SubscriptionCheckout:
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        row = await db.get(SubscriptionCheckout, checkout_id)
        assert row is not None
        return row


async def test_demo_checkout_replay_does_not_add_second_month():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)
        first = await client.post("/api/v1/subscription/checkout", headers=headers)
        replay = await client.post("/api/v1/subscription/checkout", headers=headers)

    assert first.status_code == 200, first.text
    assert replay.status_code == 200, replay.text
    assert first.json()["checkout_status"] == "succeeded"
    assert replay.json()["checkout_status"] == "succeeded"
    assert replay.json()["replay"] is True
    assert replay.json()["checkout_id"] == first.json()["checkout_id"]

    subscription = await _subscription(user["id"])
    assert subscription.expires_at is not None
    remaining = subscription.expires_at - utc_now()
    assert timedelta(days=29, hours=23) < remaining < timedelta(days=30, minutes=1)


async def test_explicit_new_cycle_stacks_paid_remainder():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)
        first = await client.post("/api/v1/subscription/checkout", headers=headers)
        second = await client.post(
            "/api/v1/subscription/checkout",
            headers=headers,
            json={"new_cycle": True},
        )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["checkout_id"] != first.json()["checkout_id"]
    assert second.json()["checkout_status"] == "succeeded"

    subscription = await _subscription(user["id"])
    assert subscription.expires_at is not None
    remaining = subscription.expires_at - utc_now()
    assert timedelta(days=59, hours=23) < remaining < timedelta(days=60, minutes=1)


async def test_webhook_success_then_lost_response_replays_same_checkout():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)

        from app.db import session as sess

        async with sess.SessionLocal() as db:
            checkout, created = await checkout_svc.get_or_create_checkout(
                db,
                user_id=user["id"],
            )
            assert created is True
            await checkout_svc.bind_provider_payment(
                db,
                checkout_id=checkout.id,
                user_id=user["id"],
                provider_payment_id="yk-sub-lost-response",
                confirmation_url="https://pay.example/sub-lost-response",
                provider_status="pending",
                commit=True,
            )

        event = {
            "event": "payment.succeeded",
            "object": {
                "id": "yk-sub-lost-response",
                "status": "succeeded",
                "amount": {"value": "990.00", "currency": "RUB"},
                "metadata": {
                    "kind": "pro_subscription",
                    "user_id": user["id"],
                    "subscription_checkout_id": checkout.id,
                },
            },
        }
        webhook = await client.post("/api/v1/subscription/webhook", json=event)
        retry = await client.post("/api/v1/subscription/checkout", headers=headers)

    assert webhook.status_code == 200, webhook.text
    assert webhook.json()["business_applied"] is True
    assert webhook.json()["activated"] is True
    assert retry.status_code == 200, retry.text
    assert retry.json()["checkout_id"] == checkout.id
    assert retry.json()["checkout_status"] == "succeeded"
    assert retry.json()["replay"] is True

    subscription = await _subscription(user["id"])
    assert subscription.expires_at is not None
    remaining = subscription.expires_at - utc_now()
    assert timedelta(days=29, hours=23) < remaining < timedelta(days=30, minutes=1)


async def test_legacy_inflight_subscription_webhook_remains_idempotent():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, _headers = await _contractor(client)
        event = {
            "event": "payment.succeeded",
            "object": {
                "id": "yk-legacy-subscription-inflight",
                "status": "succeeded",
                "amount": {"value": "990.00", "currency": "RUB"},
                "metadata": {
                    "kind": "pro_subscription",
                    "user_id": user["id"],
                },
            },
        }
        first = await client.post("/api/v1/subscription/webhook", json=event)
        replay = await client.post("/api/v1/subscription/webhook", json=event)

    assert first.status_code == 200, first.text
    assert first.json()["business_applied"] is True
    assert first.json()["pro_user_id"] == user["id"]
    assert replay.status_code == 200, replay.text
    assert replay.json()["duplicate"] is True
    assert replay.json()["business_applied"] is False

    subscription = await _subscription(user["id"])
    assert subscription.expires_at is not None
    remaining = subscription.expires_at - utc_now()
    assert timedelta(days=29, hours=23) < remaining < timedelta(days=30, minutes=1)

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        rows = (
            await db.execute(
                select(SubscriptionCheckout).where(
                    SubscriptionCheckout.user_id == user["id"]
                )
            )
        ).scalars().all()
        assert rows == []


async def test_duplicate_settlement_cannot_extend_entitlement_twice():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, _headers = await _contractor(client)

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        checkout, _ = await checkout_svc.get_or_create_checkout(db, user_id=user["id"])
        await checkout_svc.bind_provider_payment(
            db,
            checkout_id=checkout.id,
            user_id=user["id"],
            provider_payment_id="yk-sub-once",
            confirmation_url=None,
            provider_status="pending",
            commit=True,
        )
        _row, changed_first = await checkout_svc.complete_checkout(
            db,
            checkout_id=checkout.id,
            user_id=user["id"],
            provider_payment_id="yk-sub-once",
            amount=990,
            currency="RUB",
            commit=True,
        )
        first_expiry = (await _subscription(user["id"])).expires_at
        _row, changed_second = await checkout_svc.complete_checkout(
            db,
            checkout_id=checkout.id,
            user_id=user["id"],
            provider_payment_id="yk-sub-once",
            amount=990,
            currency="RUB",
            commit=True,
        )

    second_expiry = (await _subscription(user["id"])).expires_at
    assert changed_first is True
    assert changed_second is False
    assert second_expiry == first_expiry


async def test_provider_cancellation_releases_cycle_for_new_checkout():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _contractor(client)

        from app.db import session as sess

        async with sess.SessionLocal() as db:
            checkout, _ = await checkout_svc.get_or_create_checkout(db, user_id=user["id"])
            await checkout_svc.bind_provider_payment(
                db,
                checkout_id=checkout.id,
                user_id=user["id"],
                provider_payment_id="yk-sub-canceled",
                confirmation_url="https://pay.example/sub-canceled",
                provider_status="pending",
                commit=True,
            )

        event = {
            "event": "payment.canceled",
            "object": {
                "id": "yk-sub-canceled",
                "status": "canceled",
                "amount": {"value": "990.00", "currency": "RUB"},
                "metadata": {
                    "kind": "pro_subscription",
                    "user_id": user["id"],
                    "subscription_checkout_id": checkout.id,
                },
                "cancellation_details": {"reason": "canceled_by_user"},
            },
        }
        canceled = await client.post("/api/v1/subscription/webhook", json=event)
        replacement = await client.post("/api/v1/subscription/checkout", headers=headers)

    assert canceled.status_code == 200, canceled.text
    assert canceled.json()["business_applied"] is True
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()["checkout_id"] != checkout.id
    canceled_checkout = await _checkout(checkout.id)
    assert canceled_checkout.status == "canceled"
    assert canceled_checkout.confirmation_url == "https://pay.example/sub-canceled"
    assert replacement.json()["checkout_status"] == "succeeded"


async def test_provider_payment_id_cannot_belong_to_two_subscription_cycles():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first_user, _headers = await _contractor(client)

    from app.db import session as sess

    second_user_id = "subscription-provider-conflict-user"
    async with sess.SessionLocal() as db:
        db.add(
            User(
                id=second_user_id,
                phone="+79990009991",
                role=UserRole.contractor,
            )
        )
        await db.commit()

        first_checkout, _ = await checkout_svc.get_or_create_checkout(
            db,
            user_id=first_user["id"],
        )
        second_checkout, _ = await checkout_svc.get_or_create_checkout(
            db,
            user_id=second_user_id,
        )
        await checkout_svc.bind_provider_payment(
            db,
            checkout_id=first_checkout.id,
            user_id=first_user["id"],
            provider_payment_id="yk-shared-subscription-id",
            confirmation_url="https://pay.example/shared",
            provider_status="pending",
            commit=True,
        )

        with pytest.raises(
            checkout_svc.SubscriptionCheckoutIntegrityError,
            match="yookassa_payment_id_conflict",
        ) as exc_info:
            await checkout_svc.bind_provider_payment(
                db,
                checkout_id=second_checkout.id,
                user_id=second_user_id,
                provider_payment_id="yk-shared-subscription-id",
                confirmation_url="https://pay.example/other",
                provider_status="pending",
                commit=True,
            )
        assert exc_info.value.code == "yookassa_payment_id_conflict"

        stored_second = await db.get(SubscriptionCheckout, second_checkout.id)
        assert stored_second is not None
        assert stored_second.provider_payment_id is None
        assert stored_second.status == "pending"
