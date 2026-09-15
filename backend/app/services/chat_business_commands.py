"""Atomic client task/invoice commands. External provider activation is out of scope.

ClientWriteRequest is the sole replay ledger. A project lock serializes composed
commands with canonical project ownership changes; no network call occurs while
that lock is held. DomainOutbox owns delivery after the one business commit.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import logging
import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChatMessage, ChatThread, Payment, PaymentType, Project, User, UserRole, WorkOrder
from app.services import chat_message_mutation as messages
from app.services import outbox_service as outbox
from app.services import payment_service, work_order_service
from app.services.chat_acl import require_chat_access
from app.services.client_write_idempotency import commit_client_write, replay_entity_id
from app.services.client_write_side_effects import prepare_client_write_side_effects

logger = logging.getLogger(__name__)
INVOICE_SCOPE = "chat.invoice.create"
TASK_SCOPE = "chat.task.create"
_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,80}\Z")


def _validate_identity(client_request_id: str) -> None:
    if not isinstance(client_request_id, str) or not _REQUEST_ID.fullmatch(client_request_id):
        raise ValueError("chat_command_request_id_invalid")


def _text(value: str, maximum: int = 255) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError("chat_command_fields_invalid")
    return value.strip()


def _money(amount: Decimal | float | int) -> Decimal:
    try:
        value = Decimal(str(amount))
        if not value.is_finite() or not Decimal("0") < value <= Decimal("99999999999999.99"):
            raise ValueError("chat_command_amount_invalid")
        cents = value.quantize(Decimal("0.01"))
        if cents != value or Decimal(str(float(value))) != value:
            raise ValueError("chat_command_amount_invalid")
        return cents
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("chat_command_amount_invalid") from exc


def _due_date(value: date | datetime | str | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        if isinstance(value, str):
            return date.fromisoformat(value) if len(value) == 10 else datetime.fromisoformat(value).date()
    except ValueError as exc:
        raise ValueError("chat_command_due_date_invalid") from exc
    raise ValueError("chat_command_due_date_invalid")


async def _authority(
    db: AsyncSession, *, project_id: str, thread_id: str, user_id: str,
    invoice: bool = False,
) -> tuple[Project, ChatThread, User]:
    project = (await db.execute(
        select(Project).where(Project.id == project_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if project is None:
        raise HTTPException(404, "chat_not_found")
    actor = (await db.execute(
        select(User).where(User.id == user_id)
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if actor is None or actor.deleted_at is not None:
        raise HTTPException(401, "account_unavailable")
    # In particular, active thread-only invitees cannot create tasks/invoices.
    project, thread = await require_chat_access(db, project_id, thread_id, actor, write=True)
    if invoice and actor.role != UserRole.contractor:
        raise HTTPException(403, "only_contractor_can_invoice_from_chat")
    return project, thread, actor


async def _replay_result(
    db: AsyncSession, *, project_id: str, thread_id: str, entity_id: str,
    kind: str,
) -> ChatMessage:
    from app.services.chat_service import _parse_meta

    message = await db.get(ChatMessage, entity_id)
    if message is None or message.thread_id != thread_id or message.message_type.value != kind:
        raise RuntimeError("chat_command_replay_message_corrupt")
    meta = _parse_meta(message.meta_json)
    model, key = (Payment, "payment_id") if kind == "payment" else (WorkOrder, "work_order_id")
    linked_id = meta.get(key)
    linked = await db.get(model, linked_id) if isinstance(linked_id, str) else None
    if linked is None or linked.project_id != project_id:
        raise RuntimeError("chat_command_replay_link_corrupt")
    return message


async def _publish_committed(db: AsyncSession, prepared: messages.PreparedChatMessage) -> ChatMessage:
    message = prepared.message
    await db.refresh(message)
    # Durable delivery remains the worker's job. No provider/inline outbox call is
    # allowed to turn an accepted command into an apparent business rollback.
    try:
        await messages._broadcast_after_commit(
            thread_id=prepared.thread_id, project_id=prepared.project_id,
            message=message, recipient_ids=prepared.recipient_ids,
        )
    except Exception:
        logger.exception("chat command websocket acceleration failed after commit")
    return message


async def create_invoice(
    db: AsyncSession, *, project_id: str, thread_id: str, user_id: str,
    client_request_id: str, title: str, amount: Decimal | float | int,
    payment_type: str,
) -> ChatMessage:
    _validate_identity(client_request_id)
    title, value = _text(title), _money(amount)
    payment_kind = PaymentType(payment_type)
    payload = {"thread_id": thread_id, "title": title, "amount": format(value, ".2f"), "payment_type": payment_kind.value}
    try:
        _project, thread, actor = await _authority(db, project_id=project_id, thread_id=thread_id, user_id=user_id, invoice=True)
        replay = await replay_entity_id(db, scope=INVOICE_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload)
        if replay:
            result = await _replay_result(db, project_id=project_id, thread_id=thread_id, entity_id=replay, kind="payment")
            await db.commit()  # Release the authority lock even for direct service callers.
            return result
        payment = await payment_service.prepare_payment(db, project_id, user_id, title, float(value), payment_kind.value)
        await prepare_client_write_side_effects(db, scope="payment.create", project_id=project_id, user_id=user_id, entity_id=payment.id)
        prepared = await messages.prepare_message(
            db, thread=thread, user_id=user_id, role=actor.role.value,
            text=f"💳 Счёт: {title} · {value:.2f} ₽", message_type="payment",
            meta={"payment_id": payment.id, "amount": float(value), "project_id": project_id},
        )
        await outbox.enqueue_once(
            db, parent_outbox_id=f"chat-invoice:{prepared.message.id}", effect_key="activity",
            aggregate_type="payment", aggregate_id=payment.id, event_type=outbox.ACTIVITY_EVENT,
            payload={"project_id": project_id, "user_id": user_id, "kind": "ChatInvoiceCreated", "title": title, "body": format(value, ".2f"), "link_path": "/(contractor)/(tabs)/budget?tab=payments"},
        )
        created, entity_id = await commit_client_write(db, scope=INVOICE_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload, entity_id=prepared.message.id)
        if not created:
            return await _replay_result(db, project_id=project_id, thread_id=thread_id, entity_id=entity_id, kind="payment")
    except BaseException:
        await db.rollback()
        raise
    return await _publish_committed(db, prepared)


async def create_task(
    db: AsyncSession, *, project_id: str, thread_id: str, user_id: str,
    client_request_id: str, message_id: str, title: str,
    assignee_id: str | None = None, due_at: date | datetime | str | None = None,
    work_type: str = "general",
) -> ChatMessage:
    from app.services.chat_service import _dump_meta, _parse_meta

    _validate_identity(client_request_id)
    title, work_type, due = _text(title), _text(work_type, 64), _due_date(due_at)
    payload = {"thread_id": thread_id, "source_message_id": message_id, "title": title, "assignee_id": assignee_id, "due_at": due.isoformat() if due else None, "work_type": work_type}
    try:
        project, thread, actor = await _authority(db, project_id=project_id, thread_id=thread_id, user_id=user_id)
        replay = await replay_entity_id(db, scope=TASK_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload)
        if replay:
            result = await _replay_result(db, project_id=project_id, thread_id=thread_id, entity_id=replay, kind="task")
            await db.commit()
            return result
        source = (await db.execute(
            select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.thread_id == thread_id)
            .with_for_update().execution_options(populate_existing=True)
        )).scalar_one_or_none()
        if source is None:
            raise HTTPException(404, "message_not_found")
        source_meta = _parse_meta(source.meta_json)
        # The existing source-message contract has ONE linked_task_id, not a list.
        # Never silently replace it with a second command using a different key.
        if source_meta.get("linked_task_id"):
            raise ValueError("chat_source_already_has_task")
        if assignee_id is not None:
            await work_order_service._validate_assignee_change(db, project=project, actor_id=user_id, assignee_id=assignee_id)
            target = await db.get(User, assignee_id)
            if target is None or target.deleted_at is not None:
                raise ValueError("work_order_assignee_invalid")
        work = await work_order_service.prepare_work_order(
            db, project_id=project_id, user_id=user_id, title=title,
            work_type=work_type, planned_start=due, planned_end=due, publish=True,
        )
        work.assignee_id = assignee_id
        text = f"📋 Задача: {title}" + (f" · до {due.isoformat()}" if due else "")
        prepared = await messages.prepare_message(
            db, thread=thread, user_id=user_id, role=actor.role.value, text=text, message_type="task",
            meta={"work_order_id": work.id, "assignee_id": assignee_id, "due_at": payload["due_at"], "source_message_id": message_id},
        )
        source_meta["linked_task_id"] = work.id
        source.meta_json = _dump_meta(source_meta)
        created, entity_id = await commit_client_write(db, scope=TASK_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload, entity_id=prepared.message.id)
        if not created:
            return await _replay_result(db, project_id=project_id, thread_id=thread_id, entity_id=entity_id, kind="task")
    except BaseException:
        await db.rollback()
        raise
    return await _publish_committed(db, prepared)
