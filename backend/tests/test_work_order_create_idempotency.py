"""P0 #316: direct WorkOrder create is exactly-once under replay/response loss."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import ChatThread, Project, User, UserRole, WorkOrder
from app.services import work_order_client_write as writer
from app.services.client_write_idempotency import IdempotencyConflict


async def _seed(db):
    customer = User(id="wo-replay-customer", phone="+70000000901", role=UserRole.customer)
    project = Project(
        id="wo-replay-project",
        name="Replay project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add_all([customer, project])
    await db.commit()
    return customer, project


async def _count(db, model, *where) -> int:
    query = select(func.count()).select_from(model)
    if where:
        query = query.where(*where)
    return int((await db.execute(query)).scalar_one())


@pytest.mark.asyncio
async def test_same_intent_replays_one_work_order_graph(db, monkeypatch):
    customer, project = await _seed(db)
    project_id = project.id
    customer_id = customer.id

    async def no_inline(*args, **kwargs):
        return None

    monkeypatch.setattr(writer.work_order_service, "_dispatch_committed_effects", no_inline)
    kwargs = dict(
        project_id=project_id,
        user_id=customer_id,
        client_request_id="work-order-replay-key-001",
        title="Paint wall",
        work_type="paint",
        budget_planned=1250.5,
        publish=True,
    )
    first = await writer.create_work_order(db, **kwargs)
    second = await writer.create_work_order(db, **kwargs)

    assert second.id == first.id
    assert await _count(db, WorkOrder, WorkOrder.project_id == project_id) == 1
    assert await _count(db, ChatThread, ChatThread.project_id == project_id) == 1
    assert await _count(
        db,
        ClientWriteRequest,
        ClientWriteRequest.scope == writer.WORK_ORDER_CREATE_SCOPE,
        ClientWriteRequest.project_id == project_id,
        ClientWriteRequest.user_id == customer_id,
    ) == 1


@pytest.mark.asyncio
async def test_same_request_id_with_changed_payload_is_conflict(db, monkeypatch):
    customer, project = await _seed(db)
    project_id = project.id
    customer_id = customer.id

    async def no_inline(*args, **kwargs):
        return None

    monkeypatch.setattr(writer.work_order_service, "_dispatch_committed_effects", no_inline)
    await writer.create_work_order(
        db,
        project_id=project_id,
        user_id=customer_id,
        client_request_id="work-order-replay-key-002",
        title="Paint wall",
        work_type="paint",
    )

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await writer.create_work_order(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="work-order-replay-key-002",
            title="Different task",
            work_type="paint",
        )

    # The conflict path rolls the ORM transaction back and expires mapped rows;
    # assert with immutable scalar IDs captured before rollback, not expired ORM IO.
    assert await _count(db, WorkOrder, WorkOrder.project_id == project_id) == 1


@pytest.mark.asyncio
async def test_invalid_request_identity_creates_nothing(db):
    customer, project = await _seed(db)
    project_id = project.id
    customer_id = customer.id
    with pytest.raises(ValueError, match="work_order_request_id_invalid"):
        await writer.create_work_order(
            db,
            project_id=project_id,
            user_id=customer_id,
            client_request_id="short",
            title="Task",
            work_type="other",
        )
    assert await _count(db, WorkOrder, WorkOrder.project_id == project_id) == 0
    assert await _count(db, ClientWriteRequest, ClientWriteRequest.project_id == project_id) == 0


@pytest.mark.asyncio
async def test_revoked_project_writer_is_rejected_before_prepare(db, monkeypatch):
    customer, project = await _seed(db)
    project_id = project.id
    outsider = User(id="wo-replay-outsider", phone="+70000000902", role=UserRole.customer)
    outsider_id = outsider.id
    db.add(outsider)
    await db.commit()

    called = False

    async def should_not_prepare(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("prepare_work_order must not run for unauthorized actor")

    monkeypatch.setattr(writer.work_order_service, "prepare_work_order", should_not_prepare)
    with pytest.raises(ValueError, match="work_order_create_forbidden"):
        await writer.create_work_order(
            db,
            project_id=project_id,
            user_id=outsider_id,
            client_request_id="work-order-replay-key-003",
            title="Task",
            work_type="other",
        )
    assert called is False
    assert await _count(db, WorkOrder, WorkOrder.project_id == project_id) == 0
