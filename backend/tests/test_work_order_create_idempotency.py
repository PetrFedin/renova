"""P0 #316: direct WorkOrder create must survive response loss exactly once."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.work_orders import WorkOrderCreate, create_work_order
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import ChatThread, Project, User, UserRole, WorkOrder
from app.services import work_order_service as wo_svc

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(
        phone="+79990003101",
        role=UserRole.customer,
        full_name="WO idempotency customer",
    )
    contractor = User(
        phone="+79990003102",
        role=UserRole.contractor,
        full_name="WO idempotency contractor",
    )
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        name="WO idempotency project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return customer, contractor, project


async def _no_dispatch(*_args, **_kwargs):
    return None


async def test_direct_work_order_response_loss_replay_returns_one_canonical_graph(db, monkeypatch):
    customer, _, project = await _fixture(db)
    monkeypatch.setattr(wo_svc, "_dispatch_committed_effects", _no_dispatch)

    body = WorkOrderCreate(
        title="Покраска стен",
        work_type="painting",
        budget_planned=12500.25,
        notes="P0 response-loss proof",
        publish=True,
        client_request_id="wo-response-loss-0001",
    )

    first = await create_work_order(project.id, body, customer, db)
    assert first["idempotent_replay"] is False

    # Simulate: server committed, client never observed the response and replays
    # the exact durable command from the offline queue.
    replay = await create_work_order(project.id, body, customer, db)
    assert replay["id"] == first["id"]
    assert replay["idempotent_replay"] is True

    work_order_count = await db.scalar(
        select(func.count()).select_from(WorkOrder).where(WorkOrder.project_id == project.id)
    )
    assert work_order_count == 1

    thread_count = await db.scalar(
        select(func.count()).select_from(ChatThread).where(
            ChatThread.project_id == project.id,
            ChatThread.topic == f"work:{first['id']}",
        )
    )
    assert thread_count == 1

    request_count = await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == "work_order.create",
            ClientWriteRequest.project_id == project.id,
            ClientWriteRequest.user_id == customer.id,
            ClientWriteRequest.request_id == body.client_request_id,
        )
    )
    assert request_count == 1


async def test_direct_work_order_same_request_id_different_payload_is_409(db, monkeypatch):
    customer, _, project = await _fixture(db)
    monkeypatch.setattr(wo_svc, "_dispatch_committed_effects", _no_dispatch)

    request_id = "wo-conflict-proof-0001"
    first = WorkOrderCreate(
        title="Стяжка пола",
        work_type="flooring",
        budget_planned=8000,
        client_request_id=request_id,
    )
    await create_work_order(project.id, first, customer, db)

    changed = WorkOrderCreate(
        title="Стяжка пола — изменённая команда",
        work_type="flooring",
        budget_planned=8000,
        client_request_id=request_id,
    )
    with pytest.raises(HTTPException) as exc_info:
        await create_work_order(project.id, changed, customer, db)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "idempotency_conflict"

    work_order_count = await db.scalar(
        select(func.count()).select_from(WorkOrder).where(WorkOrder.project_id == project.id)
    )
    assert work_order_count == 1
