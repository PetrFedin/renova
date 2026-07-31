from __future__ import annotations

import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    DomainOutbox,
    Project,
    Stage,
    User,
    UserRole,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import DomainOutboxLease, SideEffectDelivery
from app.services import notification_service, outbox_service


@pytest_asyncio.fixture
async def outbox_store(tmp_path):
    db_path = tmp_path / "outbox-fencing.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"timeout": 30},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield engine, session_factory
    await engine.dispose()


async def _enqueue_unknown(session_factory, *, aggregate_id: str = "aggregate-1") -> str:
    async with session_factory() as db:
        row = await outbox_service.enqueue(
            db,
            aggregate_type="test",
            aggregate_id=aggregate_id,
            event_type="unknown.event",
            payload={},
        )
        await db.commit()
        return row.id


@pytest.mark.asyncio
async def test_stale_worker_cannot_overwrite_new_claim(outbox_store):
    _engine, session_factory = outbox_store
    outbox_id = await _enqueue_unknown(session_factory)
    started = utc_now()

    async with session_factory() as db:
        token_a = await outbox_service._claim(
            db,
            outbox_id=outbox_id,
            worker_id="worker-a",
            now=started,
        )
    assert token_a is not None

    async with session_factory() as db:
        token_b = await outbox_service._claim(
            db,
            outbox_id=outbox_id,
            worker_id="worker-b",
            now=started + outbox_service.LEASE_TTL + timedelta(seconds=1),
        )
    assert token_b is not None
    assert token_b != token_a

    async with session_factory() as db:
        released = await outbox_service._release_failure(
            db,
            outbox_id=outbox_id,
            claim_token=token_a,
            error=RuntimeError("stale-worker-error"),
            now=utc_now(),
        )
    assert released is False

    async with session_factory() as db:
        row = await db.get(DomainOutbox, outbox_id)
        lease = await db.get(DomainOutboxLease, outbox_id)
    assert row.attempts == 0
    assert row.last_error is None
    assert lease.locked_by == token_b

    async with session_factory() as db:
        released = await outbox_service._release_failure(
            db,
            outbox_id=outbox_id,
            claim_token=token_b,
            error=RuntimeError("current-worker-error"),
            now=utc_now(),
        )
    assert released is True

    async with session_factory() as db:
        row = await db.get(DomainOutbox, outbox_id)
        lease = await db.get(DomainOutboxLease, outbox_id)
    assert row.attempts == 1
    assert row.last_error == "current-worker-error"
    assert lease.locked_by is None
    assert lease.next_attempt_at is not None


@pytest.mark.asyncio
async def test_cancelled_worker_releases_claim_without_consuming_attempt(
    outbox_store,
    monkeypatch,
):
    _engine, session_factory = outbox_store
    outbox_id = await _enqueue_unknown(session_factory, aggregate_id="cancelled")
    entered = asyncio.Event()
    hold = asyncio.Event()

    async def blocking_handle(_db, _row):
        entered.set()
        await hold.wait()

    monkeypatch.setattr(outbox_service, "_handle", blocking_handle)

    async def run_dispatch():
        async with session_factory() as db:
            await outbox_service.dispatch_pending(
                db,
                limit=1,
                worker_id="cancelled-worker",
            )

    task = asyncio.create_task(run_dispatch())
    await asyncio.wait_for(entered.wait(), timeout=5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    async with session_factory() as db:
        row = await db.get(DomainOutbox, outbox_id)
        lease = await db.get(DomainOutboxLease, outbox_id)
    assert row.processed_at is None
    assert row.attempts == 0
    assert lease.locked_at is None
    assert lease.locked_by is None
    assert lease.next_attempt_at is not None


@pytest.mark.asyncio
async def test_acceptance_parent_replay_does_not_duplicate_leaf_effects(
    outbox_store,
    monkeypatch,
):
    _engine, session_factory = outbox_store
    send_push = AsyncMock(return_value=True)
    monkeypatch.setattr(notification_service, "send_push", send_push)

    async with session_factory() as db:
        customer = User(
            id="outbox-customer",
            phone="+79990003001",
            role=UserRole.customer,
        )
        contractor = User(
            id="outbox-contractor",
            phone="+79990003002",
            role=UserRole.contractor,
        )
        project = Project(
            id="outbox-project",
            name="Acceptance outbox",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
        )
        stage = Stage(
            id="outbox-stage",
            project_id=project.id,
            name="Чистовая отделка",
            sort_order=1,
        )
        db.add_all([customer, contractor, project, stage])
        await db.flush()
        parent = await outbox_service.enqueue(
            db,
            aggregate_type="work_acceptance",
            aggregate_id="acceptance-1",
            event_type=outbox_service.ACCEPTANCE_SIDE_EFFECTS_EVENT,
            payload={
                "project_id": project.id,
                "stage_id": stage.id,
                "accepted_by": customer.id,
                "comment": "Принято",
                "payment_id": None,
                "next_stage_id": None,
                "source": "app",
            },
        )
        parent_id = parent.id
        await db.commit()

    async with session_factory() as db:
        assert await outbox_service.dispatch_pending(
            db,
            limit=20,
            worker_id="fanout-worker-a",
        ) == 6

    async with session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(ActivityEvent)) == 2
        assert await db.scalar(select(func.count()).select_from(AppNotification)) == 3
        assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 6
        assert await db.scalar(select(func.count()).select_from(SideEffectDelivery)) == 5
    assert send_push.await_count == 3

    async with session_factory() as db:
        parent = await db.get(DomainOutbox, parent_id)
        lease = await db.get(DomainOutboxLease, parent_id)
        parent.processed_at = None
        lease.locked_at = None
        lease.locked_by = None
        lease.next_attempt_at = None
        await db.commit()

    async with session_factory() as db:
        assert await outbox_service.dispatch_pending(
            db,
            limit=20,
            worker_id="fanout-worker-b",
        ) == 1

    async with session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(ActivityEvent)) == 2
        assert await db.scalar(select(func.count()).select_from(AppNotification)) == 3
        assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 6
        assert await db.scalar(select(func.count()).select_from(SideEffectDelivery)) == 5
    assert send_push.await_count == 3


@pytest.mark.asyncio
async def test_runtime_snapshot_exposes_poison_and_lease_state(outbox_store):
    _engine, session_factory = outbox_store
    outbox_id = await _enqueue_unknown(session_factory, aggregate_id="poison")
    async with session_factory() as db:
        row = await db.get(DomainOutbox, outbox_id)
        lease = await db.get(DomainOutboxLease, outbox_id)
        row.attempts = outbox_service.MAX_ATTEMPTS
        row.last_error = "poison-event"
        lease.locked_at = utc_now() - outbox_service.LEASE_TTL - timedelta(seconds=1)
        lease.locked_by = "dead-worker"
        await db.commit()

    async with session_factory() as db:
        snapshot = await outbox_service.runtime_snapshot(db)
    assert snapshot["pending"] == 1
    assert snapshot["retryable"] == 0
    assert snapshot["poisoned"] == 1
    assert snapshot["active_leases"] == 0
    assert snapshot["stale_leases"] == 1
    assert snapshot["oldest_pending_age_seconds"] is not None
