from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.models.provider_runtime import ProviderReconciliation
from app.services import provider_reconciliation_service as reconciliation


@pytest.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(ProviderReconciliation.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_ensure_reconciliation_is_deterministic(session_factory):
    async with session_factory() as db:
        first = await reconciliation.ensure_reconciliation(
            db,
            provider="yookassa",
            operation_type="payment_status",
            resource_type="payment",
            resource_id="payment-1",
            provider_resource_id="yk-1",
        )
        await db.commit()
        second = await reconciliation.ensure_reconciliation(
            db,
            provider="yookassa",
            operation_type="payment_status",
            resource_type="payment",
            resource_id="payment-1",
            provider_resource_id="yk-1",
        )
        await db.commit()

        assert first.id == second.id
        rows = (await db.execute(select(ProviderReconciliation))).scalars().all()
        assert len(rows) == 1
        assert rows[0].status == "pending"
        assert rows[0].attempts == 0


@pytest.mark.asyncio
async def test_claim_generation_fences_stale_worker(session_factory):
    now = utc_now()
    async with session_factory() as db:
        await reconciliation.ensure_reconciliation(
            db,
            provider="fns",
            operation_type="receipt_verify",
            resource_type="receipt",
            resource_id="receipt-1",
            next_attempt_at=now,
        )
        await db.commit()

        first = (await reconciliation.claim_due(db, worker_id="worker-a", now=now))[0]
        await db.commit()
        assert first.generation == 1
        assert first.attempts == 1

        later = now + timedelta(seconds=reconciliation.DEFAULT_LEASE_SECONDS + 1)
        second = (await reconciliation.claim_due(db, worker_id="worker-b", now=later))[0]
        await db.commit()
        assert second.generation == 2
        assert second.attempts == 2

        stale_write = await reconciliation.mark_completed(
            db,
            first,
            worker_id="worker-a",
            provider_status="verified",
        )
        await db.commit()
        assert stale_write is False

        winning_write = await reconciliation.mark_completed(
            db,
            second,
            worker_id="worker-b",
            provider_status="verified",
        )
        await db.commit()
        assert winning_write is True

        row = await db.get(ProviderReconciliation, second.id)
        assert row.status == "completed"
        assert row.provider_status == "verified"
        assert row.locked_by is None
        assert row.completed_at is not None


@pytest.mark.asyncio
async def test_retry_uses_bounded_backoff_and_safe_error_metadata(session_factory):
    now = utc_now()
    async with session_factory() as db:
        row = await reconciliation.ensure_reconciliation(
            db,
            provider="yookassa",
            operation_type="payment_status",
            resource_type="payment",
            resource_id="payment-2",
            provider_resource_id="yk-secret-looking-id",
            next_attempt_at=now,
        )
        await db.commit()
        claim = (await reconciliation.claim_due(db, worker_id="worker-a", now=now))[0]
        await db.commit()

        raw_secret = "Bearer production-secret-value"
        assert await reconciliation.mark_retry(
            db,
            claim,
            worker_id="worker-a",
            error_code="provider.timeout / unsafe spaces",
            error=RuntimeError(raw_secret),
            now=now,
        )
        await db.commit()

        saved = await db.get(ProviderReconciliation, row.id)
        assert saved.status == "retry"
        assert saved.next_attempt_at == now + timedelta(
            seconds=reconciliation.retry_delay_seconds(1)
        )
        assert saved.last_error_code == "provider.timeoutunsafespaces"
        assert saved.last_error_fingerprint
        assert raw_secret not in saved.last_error_fingerprint
        assert len(saved.last_error_fingerprint) == 64
        assert saved.locked_at is None
        assert saved.locked_by is None


@pytest.mark.asyncio
async def test_terminal_and_snapshot_are_provider_safe(session_factory):
    now = utc_now()
    async with session_factory() as db:
        await reconciliation.ensure_reconciliation(
            db,
            provider="fns",
            operation_type="receipt_verify",
            resource_type="receipt",
            resource_id="receipt-terminal",
            next_attempt_at=now,
        )
        await reconciliation.ensure_reconciliation(
            db,
            provider="yookassa",
            operation_type="payment_status",
            resource_type="payment",
            resource_id="payment-pending",
            next_attempt_at=now + timedelta(minutes=10),
        )
        await db.commit()

        claim = (await reconciliation.claim_due(db, worker_id="worker-a", now=now))[0]
        await db.commit()
        assert await reconciliation.mark_terminal(
            db,
            claim,
            worker_id="worker-a",
            error_code="provider_auth_rejected",
            error="Authorization: Basic real-secret",
            unavailable=True,
        )
        await db.commit()

        snapshot = await reconciliation.runtime_snapshot(db)
        assert snapshot["pending_total"] == 1
        assert snapshot["terminal_total"] == 1
        assert snapshot["providers"]["fns"]["unavailable"] == 1
        assert snapshot["providers"]["yookassa"]["pending"] == 1
        assert "real-secret" not in str(snapshot)
