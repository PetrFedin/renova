"""Issue #316: offline-queued POST mutations must be idempotent and atomic.

The mobile offline queue (apps/mobile/lib/offlineQueue.ts) replays a lost/ambiguous
POST with the same `X-Offline-Id` (surfaced to these endpoints as `client_request_id`
in the body). Before this fix, the backend had no consumer for that identity on the
work-order-create, chat-invoice-from-chat and chat-task-from-message flows, so a
retried request could create a second WorkOrder or a second Payment.

These tests exercise the service layer directly (same pattern as
tests/test_chat_message_atomicity.py) and assert that two calls with the same
request_id + same payload produce exactly one canonical record, while the same
request_id with a different payload is rejected as a conflict.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    Payment,
    Project,
    User,
    UserRole,
    WorkOrder,
)
from app.services import chat_service as chat_svc
from app.services import work_order_service as wo_svc
from app.services.client_write_idempotency import IdempotencyConflict


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(db):
    customer = User(
        id="a1111111-1111-1111-1111-111111111111",
        phone="+79990000101",
        role=UserRole.customer,
        full_name="Customer",
    )
    contractor = User(
        id="a2222222-2222-2222-2222-222222222222",
        phone="+79990000102",
        role=UserRole.contractor,
        full_name="Contractor",
    )
    project = Project(
        id="a3333333-3333-3333-3333-333333333333",
        name="Offline idempotency",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    thread = ChatThread(
        id="a4444444-4444-4444-4444-444444444444",
        project_id=project.id,
        title="Kitchen",
        created_by=customer.id,
    )
    db.add_all([customer, contractor, project, thread])
    await db.commit()
    return customer, contractor, project, thread


@pytest.fixture
async def session_env(monkeypatch):
    engine, Session = await _session_factory()

    async def _no_inline(*_args, **_kwargs):
        return 0

    async def _no_broadcast(*_args, **_kwargs):
        return None

    # Same no-op pattern as test_chat_message_atomicity.py: the business
    # transaction/outbox rows are what's under test, not best-effort delivery.
    monkeypatch.setattr(
        "app.services.outbox_inline_dispatch.dispatch_best_effort",
        _no_inline,
    )
    monkeypatch.setattr("app.api.v1.ws.broadcast", _no_broadcast)
    monkeypatch.setattr("app.api.v1.ws.broadcast_inbox", _no_broadcast)
    try:
        yield engine, Session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_work_order_create_same_request_id_replays_one_work_order(session_env):
    """Two identical queued POST /work-orders with the same X-Offline-Id must not
    create two WorkOrders — the second call replays the first result."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, _thread = await _seed(db)

        kwargs = dict(
            project_id=project.id,
            user_id=customer.id,
            title="Demolition",
            work_type="demolition",
            budget_planned=1000.0,
            request_id="offline-wo-0001",
        )
        first = await wo_svc.create_work_order(db, **kwargs)
        second = await wo_svc.create_work_order(db, **kwargs)

        assert second.id == first.id
        count = (
            await db.execute(select(WorkOrder).where(WorkOrder.project_id == project.id))
        ).scalars().all()
        assert len(count) == 1


@pytest.mark.asyncio
async def test_work_order_create_same_request_id_different_payload_conflicts(session_env):
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, _thread = await _seed(db)

        await wo_svc.create_work_order(
            db,
            project_id=project.id,
            user_id=customer.id,
            title="Demolition",
            work_type="demolition",
            request_id="offline-wo-0002",
        )
        with pytest.raises(IdempotencyConflict):
            await wo_svc.create_work_order(
                db,
                project_id=project.id,
                user_id=customer.id,
                title="A totally different job",
                work_type="plumbing",
                request_id="offline-wo-0002",
            )


@pytest.mark.asyncio
async def test_task_from_chat_message_replays_one_work_order_and_one_message(session_env):
    """W114 "task from chat message": a lost response/replay must yield exactly one
    WorkOrder + one linked chat message + one original-message link (#316)."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, thread = await _seed(db)
        original = ChatMessage(
            thread_id=thread.id,
            user_id=customer.id,
            author_role="customer",
            message_type=ChatMessageType.text,
            text="Please schedule the demolition",
        )
        db.add(original)
        await db.commit()
        await db.refresh(original)

        kwargs = dict(
            title="Demolition",
            assignee_id=None,
            due_at=None,
            work_type="demolition",
            request_id="offline-task-0001",
        )
        first = await chat_svc.create_task_from_message(
            db, thread, customer.id, customer.role.value, original.id, **kwargs
        )
        second = await chat_svc.create_task_from_message(
            db, thread, customer.id, customer.role.value, original.id, **kwargs
        )

        assert second.id == first.id
        work_orders = (
            await db.execute(select(WorkOrder).where(WorkOrder.project_id == project.id))
        ).scalars().all()
        assert len(work_orders) == 1

        task_messages = (
            await db.execute(
                select(ChatMessage).where(
                    ChatMessage.thread_id == thread.id,
                    ChatMessage.message_type == ChatMessageType.task,
                )
            )
        ).scalars().all()
        assert len(task_messages) == 1

        refreshed_original = await db.get(ChatMessage, original.id)
        assert refreshed_original is not None
        assert '"linked_task_id"' in (refreshed_original.meta_json or "")


@pytest.mark.asyncio
async def test_invoice_from_chat_replays_one_payment_and_one_message(session_env):
    """W110 "invoice from chat": a lost response/replay must yield exactly one
    Payment + one linked chat message (#316)."""
    _engine, Session = session_env
    async with Session() as db:
        contractor = User(
            id="a5555555-5555-5555-5555-555555555555",
            phone="+79990000103",
            role=UserRole.contractor,
            full_name="Contractor 2",
        )
        customer = User(
            id="a6666666-6666-6666-6666-666666666666",
            phone="+79990000104",
            role=UserRole.customer,
            full_name="Customer 2",
        )
        project = Project(
            id="a7777777-7777-7777-7777-777777777777",
            name="Invoice idempotency",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
        )
        thread = ChatThread(
            id="a8888888-8888-8888-8888-888888888888",
            project_id=project.id,
            title="Bathroom",
            created_by=contractor.id,
        )
        db.add_all([contractor, customer, project, thread])
        await db.commit()

        kwargs = dict(
            title="Advance payment",
            amount=15000.0,
            payment_type="advance",
            request_id="offline-invoice-0001",
        )
        first = await chat_svc.create_payment_message(
            db, thread, contractor.id, contractor.role.value, **kwargs
        )
        second = await chat_svc.create_payment_message(
            db, thread, contractor.id, contractor.role.value, **kwargs
        )

        assert second.id == first.id
        payments = (
            await db.execute(select(Payment).where(Payment.project_id == project.id))
        ).scalars().all()
        assert len(payments) == 1

        payment_messages = (
            await db.execute(
                select(ChatMessage).where(
                    ChatMessage.thread_id == thread.id,
                    ChatMessage.message_type == ChatMessageType.payment,
                )
            )
        ).scalars().all()
        assert len(payment_messages) == 1
