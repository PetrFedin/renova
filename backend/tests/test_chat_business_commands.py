"""P0 #316: real command/transaction boundaries, with no external providers."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import json
from types import SimpleNamespace
import uuid

from fastapi import FastAPI, HTTPException
import httpx
from pydantic import ValidationError
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

import app.models  # noqa: F401
from app.api.v1 import chats
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ChatMessage, ChatMessageType, ChatThread, ChatThreadParticipant, ChatThreadRead,
    DomainOutbox, Expense, Payment, PaymentStatus, Project, User, UserRole, WorkOrder,
)
from app.services import chat_business_commands as commands
from app.services import chat_message_mutation as messages
from app.services import chat_service, outbox_service as outbox
from app.services.client_write_idempotency import IdempotencyConflict


async def seed(db):
    customer = User(id=str(uuid.uuid4()), phone=f"+799{uuid.uuid4().int % 100000000:08d}", role=UserRole.customer)
    contractor = User(id=str(uuid.uuid4()), phone=f"+798{uuid.uuid4().int % 100000000:08d}", role=UserRole.contractor)
    outsider = User(id=str(uuid.uuid4()), phone=f"+797{uuid.uuid4().int % 100000000:08d}", role=UserRole.contractor)
    db.add_all([customer, contractor, outsider])
    await db.flush()
    project = Project(id=str(uuid.uuid4()), name="Command integrity", renovation_type="cosmetic", customer_id=customer.id, contractor_id=contractor.id)
    db.add(project)
    await db.flush()
    thread = ChatThread(id=str(uuid.uuid4()), project_id=project.id, title="Commands", created_by=customer.id)
    db.add(thread)
    await db.flush()
    source = ChatMessage(id=str(uuid.uuid4()), thread_id=thread.id, user_id=customer.id, author_role="customer", message_type=ChatMessageType.text, text="Please repair", meta_json=json.dumps({"reactions": {"ok": [customer.id]}}))
    db.add(source)
    await db.commit()
    return SimpleNamespace(customer=customer.id, contractor=contractor.id, outsider=outsider.id, project=project.id, thread=thread.id, source=source.id)


@pytest.fixture(autouse=True)
def no_external_delivery(monkeypatch):
    async def no_broadcast(**kwargs):
        return None
    async def forbidden_provider(*args, **kwargs):
        raise AssertionError("a chat business command must not activate providers")
    monkeypatch.setattr(messages, "_broadcast_after_commit", no_broadcast)
    monkeypatch.setattr(messages.outbox_inline_dispatch, "dispatch_best_effort", forbidden_provider)


async def invoice(db, s, **overrides):
    args = dict(project_id=s.project, thread_id=s.thread, user_id=s.contractor,
                client_request_id="invoice-response-loss-001", title="Materials", amount=Decimal("1000.25"), payment_type="material")
    args.update(overrides)
    return await commands.create_invoice(db, **args)


async def task(db, s, **overrides):
    args = dict(project_id=s.project, thread_id=s.thread, user_id=s.contractor,
                client_request_id="task-response-loss-001", message_id=s.source, title="Repair", assignee_id=s.contractor, due_at=date(2026, 10, 1))
    args.update(overrides)
    return await commands.create_task(db, **args)


async def count(db, model, *where):
    return await db.scalar(select(func.count()).select_from(model).where(*where))


@pytest.mark.asyncio
async def test_invoice_response_loss_replay_returns_original_payment_and_message(db):
    s = await seed(db)
    actor = await db.get(User, s.contractor)
    body = chats.PaymentFromChat.model_validate({"title": "Materials", "amount": "1000.25", "payment_type": "material", "client_request_id": "invoice-response-loss-001"})
    first = await chats.invoice_from_chat(s.project, s.thread, body, actor, db)
    # New session models process/request restart after the committed response was lost.
    Session = async_sessionmaker(db.bind, expire_on_commit=False)
    async with Session() as fresh:
        actor = await fresh.get(User, s.contractor)
        second = await chats.invoice_from_chat(s.project, s.thread, body, actor, fresh)
        assert second["id"] == first["id"]
        assert second["payment_id"] == first["payment_id"]
        assert await count(fresh, Payment, Payment.project_id == s.project) == 1
        assert await count(fresh, ChatMessage, ChatMessage.thread_id == s.thread) == 2
        assert await count(fresh, ClientWriteRequest, ClientWriteRequest.project_id == s.project) == 1
        effects = (await fresh.execute(select(DomainOutbox))).scalars().all()
        assert len(effects) == 3
        assert {e.event_type for e in effects} == {outbox.PAYMENT_CREATED_EVENT, outbox.NOTIFICATION_EVENT, outbox.ACTIVITY_EVENT}
        assert all(json.loads(e.payload_json)["project_id"] == s.project for e in effects)
        assert (await fresh.get(Payment, first["payment_id"])).status == PaymentStatus.pending
        assert await count(fresh, Expense) == 0, "invoicing is not cash settlement or expense recognition"


@pytest.mark.asyncio
async def test_task_replay_keeps_one_work_thread_assignment_source_link_and_effect_set(db):
    s = await seed(db)
    first = await task(db, s)
    first_id, work_id = first.id, chat_service.msg_dict(first)["work_order_id"]
    Session = async_sessionmaker(db.bind, expire_on_commit=False)
    async with Session() as fresh:
        second = await task(fresh, s, due_at=datetime(2026, 10, 1, 14, 30))
        assert second.id == first_id, "the same calendar date has one canonical identity"
        assert await count(fresh, WorkOrder, WorkOrder.project_id == s.project) == 1
        assert await count(fresh, ChatThread, ChatThread.project_id == s.project) == 2
        assert await count(fresh, ClientWriteRequest, ClientWriteRequest.project_id == s.project) == 1
        assert await count(fresh, DomainOutbox) == 2
        work = await fresh.get(WorkOrder, work_id)
        assert work.assignee_id == s.contractor
        assert work.planned_end == date(2026, 10, 1)
        assert work.chat_thread_id != s.thread
        assert (await fresh.get(ChatThread, work.chat_thread_id)).topic == f"work:{work_id}"
        original = await fresh.get(ChatMessage, s.source)
        assert json.loads(original.meta_json) == {"linked_task_id": work_id, "reactions": {"ok": [s.customer]}}
        assert chat_service.msg_dict(original)["work_order_id"] == work_id


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["invoice", "task"])
async def test_changed_payload_with_same_key_conflicts_without_second_operation(db, kind):
    s = await seed(db)
    operation = invoice if kind == "invoice" else task
    first = await operation(db, s)
    first_id = first.id
    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await operation(db, s, title="Different")
    assert await count(db, ClientWriteRequest, ClientWriteRequest.project_id == s.project) == 1
    assert (await db.get(ChatMessage, first_id)) is not None
    assert await count(db, Payment if kind == "invoice" else WorkOrder) == 1


@pytest.mark.asyncio
async def test_invoice_distinct_intents_are_not_deduplicated_by_equal_amount(db):
    s = await seed(db)
    first = await invoice(db, s)
    second = await invoice(db, s, client_request_id="intentional-second-invoice")
    assert first.id != second.id
    assert await count(db, Payment) == 2


@pytest.mark.asyncio
async def test_task_distinct_key_cannot_overwrite_existing_source_link(db):
    s = await seed(db)
    first = await task(db, s)
    work_id = chat_service.msg_dict(first)["work_order_id"]
    with pytest.raises(ValueError, match="chat_source_already_has_task"):
        await task(db, s, client_request_id="different-task-request")
    assert await count(db, WorkOrder) == 1
    assert json.loads((await db.get(ChatMessage, s.source)).meta_json)["linked_task_id"] == work_id


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["invoice", "task"])
@pytest.mark.parametrize("failure_point", ["prepare_message", "commit"])
async def test_failure_rolls_back_business_graph_visibility_effects_and_request(db, monkeypatch, kind, failure_point):
    s = await seed(db)
    cursor = datetime(2026, 1, 1)
    state = ChatThreadRead(thread_id=s.thread, user_id=s.customer, last_read_at=cursor, is_archived=True)
    db.add(state)
    await db.commit()
    state_id = state.id
    original_prepare = messages.prepare_message
    async def broken_prepare(*args, **kwargs):
        await original_prepare(*args, **kwargs)
        raise RuntimeError("injected_precommit_failure")
    async def broken_commit(*args, **kwargs):
        await db.flush()
        raise RuntimeError("injected_precommit_failure")
    if failure_point == "prepare_message":
        monkeypatch.setattr(messages, "prepare_message", broken_prepare)
    else:
        monkeypatch.setattr(commands, "commit_client_write", broken_commit)
    with pytest.raises(RuntimeError, match="injected_precommit_failure"):
        await (invoice if kind == "invoice" else task)(db, s)
    for model in (Payment, WorkOrder, ClientWriteRequest, DomainOutbox):
        assert await count(db, model) == 0
    assert await count(db, ChatThread) == 1
    assert await count(db, ChatMessage) == 1
    original = await db.get(ChatMessage, s.source)
    assert "linked_task_id" not in json.loads(original.meta_json)
    restored = await db.get(ChatThreadRead, state_id)
    assert restored.is_archived is True
    assert restored.last_read_at == cursor


@pytest.mark.asyncio
async def test_postcommit_acceleration_failure_never_repeats_invoice(db, monkeypatch):
    s = await seed(db)
    async def broken_broadcast(**kwargs):
        raise RuntimeError("websocket_unavailable")
    monkeypatch.setattr(messages, "_broadcast_after_commit", broken_broadcast)
    first = await invoice(db, s)
    second = await invoice(db, s)
    assert first.id == second.id
    assert await count(db, Payment) == 1
    assert await count(db, DomainOutbox) == 3


@pytest.mark.asyncio
async def test_replay_requires_current_authority_not_historical_ledger_permission(db):
    s = await seed(db)
    await invoice(db, s)
    project = await db.get(Project, s.project)
    project.contractor_id = s.outsider
    await db.commit()
    with pytest.raises(HTTPException) as denied:
        await invoice(db, s)
    assert denied.value.status_code == 403
    assert await count(db, Payment) == 1


@pytest.mark.asyncio
async def test_thread_only_invitee_cannot_create_business_commands(db):
    s = await seed(db)
    db.add(ChatThreadParticipant(thread_id=s.thread, user_id=s.outsider, invited_by=s.customer, status="active"))
    await db.commit()
    for operation in (invoice, task):
        with pytest.raises(HTTPException) as denied:
            await operation(db, s, user_id=s.outsider)
        assert denied.value.status_code == 403
    assert await count(db, ClientWriteRequest) == 0


@pytest.mark.asyncio
async def test_customer_cannot_invoice_and_unrelated_assignee_cannot_gain_execution(db):
    s = await seed(db)
    with pytest.raises(HTTPException) as denied:
        await invoice(db, s, user_id=s.customer)
    assert denied.value.status_code == 403
    with pytest.raises(ValueError, match="work_order_assignee_invalid"):
        await task(db, s, assignee_id=s.outsider)
    assert await count(db, WorkOrder) == 0


@pytest.mark.asyncio
async def test_cross_thread_source_rejected(db):
    s = await seed(db)
    another = ChatThread(project_id=s.project, title="Other", created_by=s.customer)
    db.add(another)
    await db.commit()
    other_id = another.id
    with pytest.raises(HTTPException) as denied:
        await task(db, s, thread_id=other_id)
    assert denied.value.status_code == 404
    assert await count(db, WorkOrder) == 0


@pytest.mark.asyncio
async def test_api_validates_request_identity_and_maps_conflict(db):
    s = await seed(db)
    app = FastAPI()
    app.include_router(chats.router, prefix="/api/v1")
    async def actor():
        return await db.get(User, s.contractor)
    async def session():
        yield db
    app.dependency_overrides[get_current_user] = actor
    app.dependency_overrides[get_db] = session
    path = f"/api/v1/projects/{s.project}/chats/{s.thread}/invoice"
    body = {"title": "Materials", "amount": "1000.25", "payment_type": "material"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post(path, json=body)).status_code == 422
        body["client_request_id"] = "http-invoice-request-001"
        first = await client.post(path, json=body)
        assert first.status_code == 200, first.text
        second = await client.post(path, json=body)
        assert second.json()["id"] == first.json()["id"]
        conflict = await client.post(path, json={**body, "amount": "2000.25"})
        assert conflict.status_code == 409
        assert conflict.json()["detail"] == "idempotency_conflict"


@pytest.mark.parametrize("amount", ["0", "-1", "NaN", "Infinity", "1.001"])
def test_invoice_schema_rejects_invalid_money(amount):
    with pytest.raises(ValidationError):
        chats.PaymentFromChat.model_validate({"title": "Work", "amount": amount, "client_request_id": "valid-key-0001"})


def test_task_schema_rejects_unknown_date_and_missing_key():
    with pytest.raises(ValidationError):
        chats.TaskFromMessage.model_validate({"title": "Work", "due_at": "tomorrow"})
