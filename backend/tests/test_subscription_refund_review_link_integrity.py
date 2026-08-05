"""Collision guards for manual subscription-refund checkout linking."""
from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import User, UserRole
from app.models.subscription_checkout import SubscriptionCheckout, SubscriptionRefund
from app.services.subscription_refund_review_service import (
    SubscriptionRefundReviewError,
    resolve_review,
)

pytestmark = pytest.mark.asyncio


async def _store(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'refund-link-collision.db'}"
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def _checkout(
    *,
    checkout_id: str,
    user_id: str,
    idempotence_key: str,
    provider_payment_id: str | None,
    status: str = "succeeded",
) -> SubscriptionCheckout:
    now = utc_now()
    return SubscriptionCheckout(
        id=checkout_id,
        user_id=user_id,
        open_key=None,
        status=status,
        amount=990.0,
        currency="RUB",
        days=30,
        idempotence_key=idempotence_key,
        provider_payment_id=provider_payment_id,
        provider_status=status,
        entitlement_before_status="free",
        entitlement_before_plan="free",
        completed_at=now,
        created_at=now,
        updated_at=now,
    )


def _claimed_refund(
    *,
    refund_id: str,
    provider_payment_id: str,
    actor_id: str,
    checkout_id: str | None,
    user_id: str | None,
) -> SubscriptionRefund:
    now = utc_now()
    return SubscriptionRefund(
        id=refund_id,
        checkout_id=checkout_id,
        user_id=user_id,
        provider_refund_id=f"provider-refund-{refund_id}",
        provider_payment_id=provider_payment_id,
        amount=990.0,
        currency="RUB",
        status="manual_review",
        entitlement_changed=False,
        reason="collision_contract",
        review_status="claimed",
        review_owner_id=actor_id,
        review_claimed_at=now,
        review_claim_expires_at=now + timedelta(minutes=10),
        review_version=1,
        created_at=now,
        applied_at=now,
    )


async def test_already_linked_refund_cannot_move_to_another_checkout(tmp_path):
    engine, sessions = await _store(tmp_path)
    try:
        async with sessions() as db:
            actor = User(
                id="collision-admin",
                phone="+79990009101",
                role=UserRole.contractor,
            )
            owner_a = User(
                id="collision-owner-a",
                phone="+79990009102",
                role=UserRole.contractor,
            )
            owner_b = User(
                id="collision-owner-b",
                phone="+79990009103",
                role=UserRole.contractor,
            )
            source = _checkout(
                checkout_id="collision-source-checkout",
                user_id=owner_a.id,
                idempotence_key="collision-source-key",
                provider_payment_id="provider-locked-to-source",
                status="refund_review",
            )
            target = _checkout(
                checkout_id="collision-target-checkout",
                user_id=owner_b.id,
                idempotence_key="collision-target-key",
                provider_payment_id=None,
            )
            refund = _claimed_refund(
                refund_id="collision-linked-refund",
                provider_payment_id="provider-locked-to-source",
                actor_id=actor.id,
                checkout_id=source.id,
                user_id=owner_a.id,
            )
            refund_id = refund.id
            actor_id = actor.id
            source_id = source.id
            target_id = target.id
            db.add_all([actor, owner_a, owner_b, source, target, refund])
            await db.commit()

            with pytest.raises(SubscriptionRefundReviewError) as exc_info:
                await resolve_review(
                    db,
                    refund_id=refund_id,
                    actor_id=actor_id,
                    expected_version=1,
                    decision_key="collision-decision-linked",
                    action="link_and_apply",
                    note="A linked refund must remain attached to its original checkout.",
                    checkout_id=target_id,
                )
            await db.rollback()

            assert exc_info.value.code == "refund_review_checkout_conflict"
            stored_refund = await db.get(SubscriptionRefund, refund_id)
            stored_source = await db.get(SubscriptionCheckout, source_id)
            stored_target = await db.get(SubscriptionCheckout, target_id)
            assert stored_refund is not None
            assert stored_refund.checkout_id == source_id
            assert stored_refund.review_status == "claimed"
            assert stored_refund.decision_key is None
            assert stored_source is not None
            assert stored_source.provider_payment_id == "provider-locked-to-source"
            assert stored_target is not None
            assert stored_target.provider_payment_id is None
    finally:
        await engine.dispose()


async def test_provider_payment_cannot_be_assigned_to_second_checkout(tmp_path):
    engine, sessions = await _store(tmp_path)
    try:
        async with sessions() as db:
            actor = User(
                id="provider-collision-admin",
                phone="+79990009201",
                role=UserRole.contractor,
            )
            owner_a = User(
                id="provider-collision-owner-a",
                phone="+79990009202",
                role=UserRole.contractor,
            )
            owner_b = User(
                id="provider-collision-owner-b",
                phone="+79990009203",
                role=UserRole.contractor,
            )
            existing_owner = _checkout(
                checkout_id="provider-owner-checkout",
                user_id=owner_a.id,
                idempotence_key="provider-owner-key",
                provider_payment_id="provider-owned-once",
            )
            target = _checkout(
                checkout_id="provider-target-checkout",
                user_id=owner_b.id,
                idempotence_key="provider-target-key",
                provider_payment_id=None,
            )
            refund = _claimed_refund(
                refund_id="provider-collision-refund",
                provider_payment_id="provider-owned-once",
                actor_id=actor.id,
                checkout_id=None,
                user_id=None,
            )
            refund_id = refund.id
            actor_id = actor.id
            owner_checkout_id = existing_owner.id
            target_id = target.id
            db.add_all([actor, owner_a, owner_b, existing_owner, target, refund])
            await db.commit()

            with pytest.raises(SubscriptionRefundReviewError) as exc_info:
                await resolve_review(
                    db,
                    refund_id=refund_id,
                    actor_id=actor_id,
                    expected_version=1,
                    decision_key="provider-collision-decision",
                    action="link_and_apply",
                    note="One provider payment must never belong to two subscription checkouts.",
                    checkout_id=target_id,
                )
            await db.rollback()

            assert exc_info.value.code == "refund_review_provider_payment_conflict"
            stored_refund = await db.get(SubscriptionRefund, refund_id)
            stored_owner = await db.get(SubscriptionCheckout, owner_checkout_id)
            stored_target = await db.get(SubscriptionCheckout, target_id)
            assert stored_refund is not None
            assert stored_refund.checkout_id is None
            assert stored_refund.review_status == "claimed"
            assert stored_refund.decision_key is None
            assert stored_owner is not None
            assert stored_owner.provider_payment_id == "provider-owned-once"
            assert stored_target is not None
            assert stored_target.provider_payment_id is None
    finally:
        await engine.dispose()
