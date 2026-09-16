"""P0 #316/#322: qualified, replay-safe chat task and invoice commands."""
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import PaymentType, User
from app.services import chat_business_commands as commands
from app.services import chat_service as chat_svc
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["chats"])


class TaskFromMessage(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=255)
    assignee_id: str | None = Field(default=None, min_length=1, max_length=36)
    due_at: date | datetime | None = None
    work_type: str = Field(default="general", min_length=1, max_length=64)


class PaymentFromChat(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    payment_type: PaymentType = PaymentType.stage


def _command_error(error: ValueError) -> HTTPException:
    code = str(error)
    if isinstance(error, IdempotencyConflict):
        return HTTPException(409, "idempotency_conflict")
    if code == "chat_source_already_has_task":
        return HTTPException(409, code)
    if code == "work_order_assignee_forbidden":
        return HTTPException(403, code)
    if code in {
        "chat_command_fields_invalid",
        "chat_command_amount_invalid",
        "chat_command_request_id_invalid",
        "chat_command_due_date_invalid",
        "work_order_assignee_invalid",
    }:
        return HTTPException(422, code)
    raise error


@router.post("/{project_id}/chats/{thread_id}/messages/{message_id}/task")
async def task_from_message_integrity(
    project_id: str,
    thread_id: str,
    message_id: str,
    body: TaskFromMessage,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        message = await commands.create_task(
            db,
            project_id=project_id,
            thread_id=thread_id,
            user_id=user.id,
            client_request_id=body.client_request_id,
            message_id=message_id,
            title=body.title,
            assignee_id=body.assignee_id,
            due_at=body.due_at,
            work_type=body.work_type,
        )
    except ValueError as error:
        raise _command_error(error) from error
    return chat_svc.msg_dict(message)


@router.post("/{project_id}/chats/{thread_id}/invoice")
async def invoice_from_chat_integrity(
    project_id: str,
    thread_id: str,
    body: PaymentFromChat,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        message = await commands.create_invoice(
            db,
            project_id=project_id,
            thread_id=thread_id,
            user_id=user.id,
            client_request_id=body.client_request_id,
            title=body.title,
            amount=body.amount,
            payment_type=body.payment_type.value,
        )
    except ValueError as error:
        raise _command_error(error) from error
    return chat_svc.msg_dict(message)
