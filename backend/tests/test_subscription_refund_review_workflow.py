"""End-to-end operational closure for ambiguous subscription refunds."""
from __future__ import annotations

import inspect

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.v1 import admin_subscription_refunds
from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import Subscription, SubscriptionStatus, User, UserRole
from app.models.subscription_checkout import (
    SubscriptionCheckout,
    SubscriptionRefund,
    SubscriptionRefundReviewEvent,
)
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "subscription_refund_review.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setattr(cfg.settings, "database_url", url)
    monkeypatch.setattr(cfg.settings, "environment", "development")
    monkeypatch.setattr(cfg.settings, "admin_user_ids", "")
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


async def _demo_user(client: AsyncClient, role: str):
    response = await client.post("/api/v1/auth/demo", json={"role": role})
    assert response.status_code == 200, response.text
    user = response.json()
    return user, {"X-User-Id": user["id"]}


async def _unknown_refund(
    client: AsyncClient,
    *,
    refund_id: str,
    payment_id: str,
    amount: str = "990.00",
):
    response = await client.post(
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
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["manual_review"] is True
    return payload


async def _checkout(client: AsyncClient, headers: dict[str, str]):
    response = await client.post(
        "/api/v1/subscription/checkout",
        headers=headers,
        json={},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _add_admin(user_id: str) -> dict[str, str]:
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        db.add(
            User(
                id=user_id,
                phone=f"+7998{abs(hash(user_id)) % 10000000:07d}",
                role=UserRole.contractor,
            )
        )
        await db.commit()
    return {"X-User-Id": user_id}


async def test_review_queue_is_admin_only_and_claim_is_concurrency_safe():
    source = inspect.getsource(admin_subscription_refunds)
    assert source.count("Depends(require_admin_user)") == 5
    assert "Depends(get_current_user)" not in source

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, admin_headers = await _demo_user(client, "contractor")
        _, customer_headers = await _demo_user(client, "customer")
        second_admin_headers = await _add_admin("refund-review-admin-2")
        refund = await _unknown_refund(
            client,
            refund_id="review-queue-refund",
            payment_id="unknown-payment-for-review",
        )
        refund_id = refund["subscription_refund_id"]

        forbidden = await client.get(
            "/api/v1/admin/subscription-refunds/reviews",
            headers=customer_headers,
        )
        queue = await client.get(
            "/api/v1/admin/subscription-refunds/reviews",
            headers=admin_headers,
        )
        claim = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/claim",
            headers=admin_headers,
            json={"expected_version": 0},
        )
        replay = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/claim",
            headers=admin_headers,
            json={"expected_version": 0},
        )
        collision = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/claim",
            headers=second_admin_headers,
            json={"expected_version": 1},
        )
        release = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/release",
            headers=admin_headers,
            json={"expected_version": 1},
        )
        takeover = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/claim",
            headers=second_admin_headers,
            json={"expected_version": 2},
        )

    assert forbidden.status_code == 403
    assert queue.status_code == 200, queue.text
    assert queue.json()["total"] == 1
    assert queue.json()["items"][0]["effective_review_status"] == "open"
    assert claim.status_code == 200, claim.text
    assert claim.json()["review_status"] == "claimed"
    assert claim.json()["review_version"] == 1
    assert claim.json()["replayed"] is False
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    assert collision.status_code == 409, collision.text
    assert collision.json()["detail"]["code"] == "refund_review_claimed_by_other"
    assert release.status_code == 200, release.text
    assert release.json()["review_status"] == "open"
    assert release.json()["review_version"] == 2
    assert takeover.status_code == 200, takeover.text
    assert takeover.json()["review_owner_id"] == "refund-review-admin-2"
    assert takeover.json()["review_version"] == 3


async def test_dismiss_resolution_is_idempotent_and_remains_auditable():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, headers = await _demo_user(client, "contractor")
        refund = await _unknown_refund(
            client,
            refund_id="review-dismiss-refund",
            payment_id="review-dismiss-payment",
        )
        refund_id = refund["subscription_refund_id"]
        claim = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/claim",
            headers=headers,
            json={"expected_version": 0},
        )
        assert claim.status_code == 200, claim.text
        decision = {
            "expected_version": 1,
            "decision_key": "dismiss-decision-0001",
            "action": "dismiss_not_subscription",
            "note": "Provider payment belongs to another product domain.",
        }
        resolved = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/resolve",
            headers=headers,
            json=decision,
        )
        replay = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/resolve",
            headers=headers,
            json=decision,
        )
        changed_replay = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/resolve",
            headers=headers,
            json={
                **decision,
                "note": "A different decision payload must never replay as success.",
            },
        )
        actionable = await client.get(
            "/api/v1/admin/subscription-refunds/reviews?status=actionable",
            headers=headers,
        )
        history = await client.get(
            "/api/v1/admin/subscription-refunds/reviews?status=resolved",
            headers=headers,
        )
        detail = await client.get(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}",
            headers=headers,
        )

    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "dismissed"
    assert resolved.json()["review_status"] == "resolved"
    assert resolved.json()["review_version"] == 2
    assert resolved.json()["replayed"] is False
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    assert changed_replay.status_code == 409, changed_replay.text
    assert (
        changed_replay.json()["detail"]["code"]
        == "refund_review_decision_payload_conflict"
    )
    assert actionable.json()["total"] == 0
    assert history.json()["total"] == 1
    assert detail.status_code == 200, detail.text
    assert [event["event_type"] for event in detail.json()["events"]] == [
        "claimed",
        "resolved",
    ]

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        event_count = await db.scalar(
            select(func.count())
            .select_from(SubscriptionRefundReviewEvent)
            .where(SubscriptionRefundReviewEvent.refund_id == refund_id)
        )
        assert event_count == 2


async def test_link_and_apply_repairs_missing_legacy_provider_link():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _demo_user(client, "contractor")
        purchase = await _checkout(client, headers)
        provider_payment_id = purchase["payment_id"]

        from app.db import session as sess

        async with sess.SessionLocal() as db:
            checkout = await db.get(SubscriptionCheckout, purchase["checkout_id"])
            assert checkout is not None
            checkout.provider_payment_id = None
            await db.commit()

        refund = await _unknown_refund(
            client,
            refund_id="review-link-refund",
            payment_id=provider_payment_id,
        )
        refund_id = refund["subscription_refund_id"]
        claim = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/claim",
            headers=headers,
            json={"expected_version": 0},
        )
        assert claim.status_code == 200, claim.text
        resolved = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/resolve",
            headers=headers,
            json={
                "expected_version": 1,
                "decision_key": "link-decision-0001",
                "action": "link_and_apply",
                "note": "Matched against the provider settlement export and checkout ledger.",
                "checkout_id": purchase["checkout_id"],
            },
        )

    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["status"] == "applied"
    assert body["review_status"] == "resolved"
    assert body["outcome"]["entitlement_changed"] is True
    assert body["outcome"]["cumulative_amount"] == 990

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        subscription = (
            await db.execute(
                select(Subscription).where(Subscription.user_id == user["id"])
            )
        ).scalar_one()
        checkout = await db.get(SubscriptionCheckout, purchase["checkout_id"])
        ledger = await db.get(SubscriptionRefund, refund_id)
        assert subscription.status == SubscriptionStatus.free
        assert subscription.plan == "free"
        assert subscription.expires_at is None
        assert checkout is not None
        assert checkout.provider_payment_id == provider_payment_id
        assert checkout.status == "refunded"
        assert checkout.refunded_amount == 990
        assert ledger is not None
        assert ledger.checkout_id == checkout.id
        assert ledger.user_id == user["id"]
        assert ledger.entitlement_changed is True


async def test_failed_link_resolution_rolls_back_without_corrupting_entitlement():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user, headers = await _demo_user(client, "contractor")
        purchase = await _checkout(client, headers)
        provider_payment_id = purchase["payment_id"]

        from app.db import session as sess

        async with sess.SessionLocal() as db:
            checkout = await db.get(SubscriptionCheckout, purchase["checkout_id"])
            assert checkout is not None
            checkout.provider_payment_id = None
            await db.commit()

        refund = await _unknown_refund(
            client,
            refund_id="review-over-refund",
            payment_id=provider_payment_id,
            amount="1200.00",
        )
        refund_id = refund["subscription_refund_id"]
        claim = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/claim",
            headers=headers,
            json={"expected_version": 0},
        )
        assert claim.status_code == 200, claim.text
        failed = await client.post(
            f"/api/v1/admin/subscription-refunds/reviews/{refund_id}/resolve",
            headers=headers,
            json={
                "expected_version": 1,
                "decision_key": "over-refund-decision-0001",
                "action": "link_and_apply",
                "note": "Attempted match must fail because refund exceeds purchase.",
                "checkout_id": purchase["checkout_id"],
            },
        )

    assert failed.status_code == 409, failed.text
    assert failed.json()["detail"]["code"] == "refund_review_exceeds_purchase"

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        subscription = (
            await db.execute(
                select(Subscription).where(Subscription.user_id == user["id"])
            )
        ).scalar_one()
        checkout = await db.get(SubscriptionCheckout, purchase["checkout_id"])
        ledger = await db.get(SubscriptionRefund, refund_id)
        assert subscription.status == SubscriptionStatus.active
        assert subscription.plan == "pro"
        assert checkout is not None
        assert checkout.provider_payment_id is None
        assert checkout.status == "succeeded"
        assert checkout.refunded_amount == 0
        assert ledger is not None
        assert ledger.status == "manual_review"
        assert ledger.review_status == "claimed"
        assert ledger.review_version == 1
        assert ledger.decision_key is None
