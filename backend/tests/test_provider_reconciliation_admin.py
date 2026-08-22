from __future__ import annotations

import inspect
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.admin_access import require_admin_user
from app.api.v1 import admin as admin_api
from app.api.v1 import admin_provider_reconciliations as admin_provider_api
from app.core.timeutil import utc_now
from app.models.provider_runtime import ProviderReconciliation
from app.services import provider_reconciliation_admin_service as admin_service
from app.services import provider_reconciliation_service as ledger


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(ProviderReconciliation.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _terminal_row(db, *, row_id: str = "11111111-1111-4111-8111-111111111111"):
    now = utc_now()
    row = ProviderReconciliation(
        id=row_id,
        provider="yookassa",
        operation_type="payment_status",
        resource_type="payment",
        resource_id="payment-public-id",
        provider_resource_id="yk-secret-provider-resource-id",
        status="unavailable",
        provider_status="pending",
        attempts=7,
        claim_generation=3,
        next_attempt_at=None,
        locked_at=now - timedelta(minutes=2),
        locked_by="stale-worker-secret",
        last_attempt_at=now - timedelta(minutes=3),
        completed_at=now - timedelta(minutes=1),
        expires_at=now - timedelta(seconds=1),
        last_error_code="yookassa_credentials_rejected",
        last_error_fingerprint="a" * 64,
        created_at=now - timedelta(days=1),
        updated_at=now - timedelta(minutes=1),
    )
    db.add(row)
    await db.commit()
    return row


@pytest.mark.asyncio
async def test_operator_views_omit_provider_identity_and_raw_runtime_state(session_factory):
    async with session_factory() as db:
        row = await _terminal_row(db)

        index = await admin_service.list_reconciliations(db)
        detail = await admin_service.get_reconciliation(
            db,
            reconciliation_id=row.id,
        )

        assert index["total"] == 1
        assert index["items"] == [detail]
        rendered = str(detail)
        assert detail["provider"] == "yookassa"
        assert detail["resource_id"] == "payment-public-id"
        assert detail["recoverable"] is True
        assert "provider_resource_id" not in detail
        assert "locked_by" not in detail
        assert "yk-secret-provider-resource-id" not in rendered
        assert "stale-worker-secret" not in rendered


@pytest.mark.asyncio
async def test_requeue_starts_fresh_fenced_lifecycle_without_erasing_provider_identity(session_factory):
    async with session_factory() as db:
        row = await _terminal_row(db)
        original_generation = row.claim_generation

        result = await admin_service.requeue_reconciliation(
            db,
            reconciliation_id=row.id,
        )

        saved = await db.get(ProviderReconciliation, row.id)
        assert saved is not None
        assert saved.status == "retry"
        assert saved.attempts == 0
        assert saved.claim_generation == original_generation + 1
        assert saved.next_attempt_at is not None
        assert saved.locked_at is None
        assert saved.locked_by is None
        assert saved.completed_at is None
        assert saved.expires_at is None
        assert saved.last_error_code is None
        assert saved.last_error_fingerprint is None
        assert saved.provider_resource_id == "yk-secret-provider-resource-id"
        assert result["recoverable"] is False
        assert "provider_resource_id" not in result
        assert "yk-secret-provider-resource-id" not in str(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "retry", "completed"])
async def test_requeue_rejects_non_terminal_state(session_factory, status):
    async with session_factory() as db:
        row = ProviderReconciliation(
            id="22222222-2222-4222-8222-222222222222",
            provider="fns",
            operation_type="receipt_verify",
            resource_type="receipt",
            resource_id="receipt-1",
            status=status,
            attempts=1,
            claim_generation=1,
            next_attempt_at=utc_now(),
        )
        db.add(row)
        await db.commit()

        with pytest.raises(admin_service.ProviderReconciliationConflict) as exc_info:
            await admin_service.requeue_reconciliation(db, reconciliation_id=row.id)
        assert exc_info.value.code == "provider_reconciliation_not_recoverable"
        assert exc_info.value.context["status"] == status


@pytest.mark.asyncio
async def test_requeue_generation_fences_any_prior_worker_claim(session_factory):
    now = utc_now()
    async with session_factory() as db:
        row = await ledger.ensure_reconciliation(
            db,
            provider="fns",
            operation_type="receipt_verify",
            resource_type="receipt",
            resource_id="receipt-fenced-recovery",
            next_attempt_at=now,
        )
        await db.commit()
        old_claim = (await ledger.claim_due(db, worker_id="worker-old", now=now))[0]
        await db.commit()
        assert await ledger.mark_terminal(
            db,
            old_claim,
            worker_id="worker-old",
            error_code="provider_auth_rejected",
            unavailable=True,
        )
        await db.commit()

        recovered = await admin_service.requeue_reconciliation(
            db,
            reconciliation_id=row.id,
        )
        assert recovered["claim_generation"] == old_claim.generation + 1

        stale_completion = await ledger.mark_completed(
            db,
            old_claim,
            worker_id="worker-old",
            provider_status="verified",
        )
        await db.commit()
        assert stale_completion is False

        saved = await db.get(ProviderReconciliation, row.id)
        assert saved.status == "retry"
        assert saved.claim_generation == old_claim.generation + 1


@pytest.mark.asyncio
async def test_admin_index_validates_status_filter(session_factory):
    async with session_factory() as db:
        with pytest.raises(admin_service.ProviderReconciliationConflict) as exc_info:
            await admin_service.list_reconciliations(db, status="made-up")
        assert exc_info.value.code == "provider_reconciliation_status_invalid"


def test_all_provider_admin_routes_require_platform_admin_dependency():
    routes = [
        route
        for route in admin_provider_api.router.routes
        if isinstance(route, APIRoute)
    ]
    assert routes
    for route in routes:
        dependencies = [dependency.call for dependency in route.dependant.dependencies]
        assert require_admin_user in dependencies, route.path


def test_admin_router_exposes_provider_reconciliation_operations():
    paths = {
        route.path
        for route in admin_api.router.routes
        if isinstance(route, APIRoute)
    }
    assert "/admin/provider-reconciliations" in paths
    assert "/admin/provider-reconciliations/{reconciliation_id}" in paths
    assert "/admin/provider-reconciliations/{reconciliation_id}/requeue" in paths


def test_release_health_includes_safe_provider_runtime_contract():
    source = inspect.getsource(admin_api.release_health)
    assert "provider_reconciliation_runtime" in source
    assert '"provider_reconciliation"' in source
    assert '"runtime_owner": "renova-worker"' in source
    assert '"recovery_ready": True' in source
