"""P0 #316: replay a real chat invoice command, not a mocked payment service."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

import app.models  # noqa: F401
from app.api.v1 import chats
from app.models.entities import ChatMessage, ChatThread, Payment, Project, User, UserRole
from app.services import outbox_inline_dispatch


@pytest.mark.asyncio
async def test_invoice_response_loss_replay_returns_original_payment_and_message(db, monkeypatch):
    async def no_delivery(*args, **kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_delivery)
    customer = User(id=str(uuid.uuid4()), phone="+79990131001", role=UserRole.customer)
    contractor = User(id=str(uuid.uuid4()), phone="+79990131002", role=UserRole.contractor)
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(id=str(uuid.uuid4()), name="Replay invoice", renovation_type="cosmetic", customer_id=customer.id, contractor_id=contractor.id)
    db.add(project)
    await db.flush()
    thread = ChatThread(id=str(uuid.uuid4()), project_id=project.id, title="Invoice", created_by=contractor.id)
    db.add(thread)
    await db.commit()
    body = chats.PaymentFromChat.model_validate({"title": "Materials", "amount": 1000.25, "payment_type": "materials", "client_request_id": "invoice-response-loss-001"})
    first = await chats.invoice_from_chat(project.id, thread.id, body, contractor, db)
    # Treat the first response as lost. The exact original request is submitted again.
    second = await chats.invoice_from_chat(project.id, thread.id, body, contractor, db)
    assert second["id"] == first["id"], "one client intent must not create another chat message"
    assert second["payment_id"] == first["payment_id"]
    assert await db.scalar(select(func.count()).select_from(Payment).where(Payment.project_id == project.id)) == 1
    assert await db.scalar(select(func.count()).select_from(ChatMessage).where(ChatMessage.thread_id == thread.id)) == 1
