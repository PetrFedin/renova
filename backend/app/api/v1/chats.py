"""Чаты проекта."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project, require_project_dep
from app.services.chat_acl import require_chat_access, require_chat_message
from app.db.session import get_db
from app.models.entities import User
from app.services import chat_participant_service as chat_participant_svc
from app.services import chat_service as chat_svc
from app.services import chat_message_mutation as chat_message_svc
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["chats"])


def _author_role_label(author_role: str | None) -> str:
    return {
        "customer": "Заказчик",
        "contractor": "Исполнитель",
        "supervisor": "Технадзор",
    }.get(author_role or "", "Система")


async def _msgs_with_read(db, thread_id, messages):
    reads = await chat_svc.read_map(db, thread_id)
    out = []
    for m in sorted(messages, key=lambda x: x.created_at):
        other_read = any(uid != m.user_id and ts >= m.created_at for uid, ts in reads.items())
        out.append(chat_svc.msg_dict(m, read_by_other=other_read))
    pinned = [x for x in out if x.get("is_pinned")]
    rest = [x for x in out if not x.get("is_pinned")]
    return pinned + rest


async def _project_unread_for_actor(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
) -> int:
    """Do not leak sibling-chat unread counts to thread-only participants."""
    try:
        await require_project(db, project_id, user, write=False)
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
        return await chat_participant_svc.participant_unread_total(
            db,
            user_id=user.id,
            exclude_project_ids=set(),
            project_id=project_id,
        )
    return await chat_svc.count_unread_project(db, project_id, user.id)


async def _chat_capabilities(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
) -> dict:
    """Return server-authoritative UI capabilities without broadening thread ACL."""
    project_read = False
    project_write = False
    try:
        await require_project(db, project_id, user, write=False)
        project_read = True
    except HTTPException as exc:
        if exc.status_code != 403:
            raise

    if project_read:
        try:
            await require_project(db, project_id, user, write=True)
            project_write = True
        except HTTPException as exc:
            if exc.status_code != 403:
                raise

    return {
        "access_scope": "project" if project_read else "thread",
        "can_view_project_actions": project_read,
        "can_manage_participants": project_write,
        "can_create_task": project_write,
        "can_create_invoice": project_write and user.role.value == "contractor",
    }


class ThreadCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    topic: str | None = None


class ThreadState(BaseModel):
    is_pinned: bool | None = None
    is_archived: bool | None = None


class ReadBody(BaseModel):
    read_through_message_id: str = Field(min_length=1, max_length=36)


class MessageCreate(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80)
    text: str | None = None
    message_type: str = "text"
    image_data: str | None = None
    reply_to_id: str | None = None


class ReactionBody(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


class InviteBody(BaseModel):
    phone: str | None = None
    profile_code: str | None = None


class TaskFromMessage(BaseModel):
    title: str
    assignee_id: str | None = None
    due_at: str | None = None
    work_type: str = "general"


class PaymentFromChat(BaseModel):
    title: str
    amount: float = Field(gt=0)
    payment_type: str = "stage"


@router.get("/{project_id}/chats")
async def list_chats(project_id: str, archived: bool = False, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    threads = await chat_svc.list_threads_enriched(db, project_id, user.id)
    if archived:
        return [t for t in threads if t.get("is_archived")]
    return [t for t in threads if not t.get("is_archived")]


@router.post("/{project_id}/chats")
async def create_chat(project_id: str, body: ThreadCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    t = await chat_svc.create_thread(db, project_id, user.id, body.title, body.topic)
    return chat_svc.thread_dict(t)


# Static chat collection/resource routes must be registered before /{thread_id}.
@router.get("/{project_id}/chats/unread-count")
async def unread_count(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    count = await chat_svc.count_unread_project(db, project_id, user.id)
    return {"count": count}


@router.get("/{project_id}/chats/search")
async def search_messages(project_id: str, q: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    from sqlalchemy import select
    from app.models.entities import ChatMessage, ChatThread
    r = await db.execute(select(ChatMessage).join(ChatThread).where(ChatThread.project_id == project_id, ChatMessage.text.ilike(f"%{q}%")).limit(30))
    return [{"thread_id": m.thread_id, "text": m.text, "created_at": m.created_at.isoformat()} for m in r.scalars().all()]


@router.get("/{project_id}/chats/{thread_id}.pdf")
async def chat_thread_pdf(project_id: str, thread_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.pdf_helper import new_pdf, pdf_line, pdf_response
    _project, t = await require_chat_access(
        db, project_id, thread_id, user, write=False, allow_participant=True,
    )
    msgs = await _msgs_with_read(db, thread_id, t.messages)
    pdf = new_pdf()
    pdf_line(pdf, f"Чат: {t.title}", size=14)
    pdf_line(pdf, f"Экспорт: {user.full_name or user.phone or user.id[:8]}", size=10)
    pdf_line(pdf, "")
    for m in msgs:
        role = _author_role_label(m.get("author_role"))
        ts = (m.get("created_at") or "")[:16].replace("T", " ")
        body = m.get("text") or f"[{m.get('message_type', 'msg')}]"
        pdf_line(pdf, f"{ts} · {role}: {body[:200]}", size=9)
    return pdf_response(pdf, f"chat-{thread_id[:8]}.pdf")


@router.patch("/{project_id}/chats/{thread_id}/state")
async def patch_thread_state(project_id: str, thread_id: str, body: ThreadState, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_chat_access(
        db, project_id, thread_id, user, write=False, allow_participant=True,
    )
    return await chat_svc.set_thread_state(db, thread_id, user.id, is_pinned=body.is_pinned, is_archived=body.is_archived)


@router.post("/{project_id}/chats/{thread_id}/read")
async def mark_read(project_id: str, thread_id: str, body: ReadBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_chat_access(
        db, project_id, thread_id, user, write=False, allow_participant=True,
    )
    try:
        thread_unread = await chat_svc.mark_thread_read(
            db,
            thread_id,
            user.id,
            body.read_through_message_id,
        )
    except ValueError as exc:
        if str(exc) == "read_cursor_not_in_thread":
            raise HTTPException(409, "read_cursor_not_in_thread") from exc
        raise
    project_unread = await _project_unread_for_actor(db, project_id=project_id, user=user)
    return {
        "ok": True,
        "read_through_message_id": body.read_through_message_id,
        "thread_unread": thread_unread,
        "project_unread": project_unread,
    }


@router.get("/{project_id}/chats/{thread_id}")
async def get_chat(project_id: str, thread_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _p, t = await require_chat_access(
        db, project_id, thread_id, user, write=False, allow_participant=True,
    )
    state = await chat_svc.get_thread_read_state(db, thread_id, user.id)
    unread = await chat_svc.count_unread_in_thread(db, thread_id, user.id)
    return {
        **chat_svc.thread_dict(
            t,
            unread=unread,
            is_pinned=bool(state and state.is_pinned),
            is_archived=bool(state and state.is_archived),
            pinned_at=state.pinned_at if state else None,
        ),
        "messages": await _msgs_with_read(db, thread_id, t.messages),
        "participants": await chat_svc.list_participants(db, thread_id),
        "capabilities": await _chat_capabilities(db, project_id=project_id, user=user),
    }


@router.get("/{project_id}/chats/{thread_id}/participants")
async def get_participants(project_id: str, thread_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_chat_access(
        db, project_id, thread_id, user, write=False, allow_participant=True,
    )
    return await chat_svc.list_participants(db, thread_id)


@router.post("/{project_id}/chats/{thread_id}/invite")
async def invite_to_chat(project_id: str, thread_id: str, body: InviteBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _p, t = await require_chat_access(db, project_id, thread_id, user, write=True)
    if bool(body.phone) == bool(body.profile_code):
        raise HTTPException(400, "invite_requires_exactly_one_target")
    chat_svc.ensure_profile_code(user)
    try:
        return await chat_svc.invite_participant(
            db,
            t,
            user,
            phone=body.phone,
            profile_code=body.profile_code,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "invite_profile_not_found":
            raise HTTPException(404, code) from exc
        if code == "invite_self_not_allowed":
            raise HTTPException(409, code) from exc
        if code in {"invite_requires_exactly_one_target", "invite_phone_invalid"}:
            raise HTTPException(422, code) from exc
        raise


@router.post("/{project_id}/chats/{thread_id}/messages")
async def _post_message(project_id: str, thread_id: str, body: MessageCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _project, t = await require_chat_access(
        db, project_id, thread_id, user, write=True, allow_participant=True,
    )
    try:
        msg = await chat_message_svc.send_client_message(
            db,
            thread=t,
            user_id=user.id,
            role=user.role.value,
            client_request_id=body.client_request_id,
            text=body.text,
            message_type=body.message_type,
            image_data=body.image_data,
            reply_to_id=body.reply_to_id,
        )
    except IdempotencyConflict as exc:
        raise HTTPException(409, "idempotency_conflict") from exc
    except ValueError as exc:
        code = str(exc)
        if code == "reply_target_not_in_thread":
            raise HTTPException(409, code) from exc
        if code == "invalid_message_type":
            raise HTTPException(422, code) from exc
        raise
    return chat_svc.msg_dict(msg)


@router.post("/{project_id}/chats/{thread_id}/messages/{message_id}/confirm")
async def _confirm_message(project_id: str, thread_id: str, message_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Подтверждение сообщения в чате.

    P0: проверки ДО любых commit.
    Payment-сообщения НЕ меняют финансовый статус — только deep-link в PaymentDetailSheet
    (канон: POST /payments/{id}/confirm с transfer_ack/receipt).
    """
    project, t = await require_chat_access(db, project_id, thread_id, user, write=True)
    msg = await require_chat_message(db, t, message_id)
    if msg.message_type.value not in ("confirm", "payment"):
        raise HTTPException(400, "Не запрос подтверждения")

    if msg.message_type.value == "payment":
        if user.id != project.customer_id:
            raise HTTPException(403, "only_customer_can_confirm_payment")
        meta = chat_svc._parse_meta(msg.meta_json)
        pid = meta.get("payment_id")
        if pid:
            meta_project = meta.get("project_id")
            if meta_project and str(meta_project) != str(project_id):
                raise HTTPException(409, "payment_project_mismatch")
        # Honesty: не вызываем confirm_payment — клиент открывает карточку оплаты
        out = chat_svc.msg_dict(msg)
        out["finance_action"] = "open_payment_sheet"
        out["payment_id"] = pid
        return out

    # Обычный confirm (не платёж) — только после ACL
    msg.confirmed = True
    await db.commit()
    await db.refresh(msg)
    return chat_svc.msg_dict(msg)


@router.post("/{project_id}/chats/{thread_id}/messages/{message_id}/react")
async def react_message(project_id: str, thread_id: str, message_id: str, body: ReactionBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _p, t = await require_chat_access(
        db, project_id, thread_id, user, write=False, allow_participant=True,
    )
    await require_chat_message(db, t, message_id)
    reactions = await chat_svc.toggle_reaction(db, message_id, user.id, body.emoji)
    return {"reactions": reactions}


@router.post("/{project_id}/chats/{thread_id}/messages/{message_id}/pin")
async def pin_msg(project_id: str, thread_id: str, message_id: str, pin: bool = True, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _p, t = await require_chat_access(db, project_id, thread_id, user, write=True)
    await require_chat_message(db, t, message_id)
    msg = await chat_svc.pin_message(db, message_id, pin)
    if not msg:
        raise HTTPException(404)
    return chat_svc.msg_dict(msg)


@router.post("/{project_id}/chats/{thread_id}/messages/{message_id}/task")
async def task_from_message(project_id: str, thread_id: str, message_id: str, body: TaskFromMessage, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _p, t = await require_chat_access(db, project_id, thread_id, user, write=True)
    await require_chat_message(db, t, message_id)
    msg = await chat_svc.create_task_from_message(
        db, t, user.id, user.role.value, message_id,
        title=body.title, assignee_id=body.assignee_id, due_at=body.due_at, work_type=body.work_type,
    )
    return chat_svc.msg_dict(msg)


@router.post("/{project_id}/chats/{thread_id}/invoice")
async def invoice_from_chat(project_id: str, thread_id: str, body: PaymentFromChat, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _p, t = await require_chat_access(db, project_id, thread_id, user, write=True)
    if user.role.value != "contractor":
        raise HTTPException(403, "only_contractor_can_invoice_from_chat")
    msg = await chat_svc.create_payment_message(
        db, t, user.id, user.role.value, title=body.title, amount=body.amount, payment_type=body.payment_type,
    )
    return chat_svc.msg_dict(msg)