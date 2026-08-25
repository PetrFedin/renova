from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.chats import MessageCreate
from app.db.session import get_db
from app.models.entities import User
from app.services import chat_message_mutation as chat_message_svc
from app.services import chat_service as chat_svc
from app.services.chat_acl import require_chat_access
from app.services import technical_supervision_action_service as actions
from app.services import technical_supervision_service as supervision
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["chats"])


@router.post("/{project_id}/chats/{thread_id}/messages")
async def post_operational_message(
    project_id: str,
    thread_id: str,
    body: MessageCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, thread = await require_chat_access(
        db,
        project_id,
        thread_id,
        user,
        write=False,
    )
    actor_mode = await supervision.require_capability(
        db,
        user=user,
        project=project,
        capability="communication",
    )
    if actor_mode == "supervisor" and body.message_type not in {"text", "photo", "file"}:
        raise HTTPException(
            403,
            detail={
                "code": "technical_supervision_chat_type_forbidden",
                "message": "Технадзор может отправлять обычные сообщения и вложения, но не финансовые/системные действия.",
            },
        )

    supervisor_id = await actions.active_supervisor_user_id(db, project.id)
    extra_recipients = {supervisor_id} if supervisor_id else set()
    author_role = "supervisor" if actor_mode == "supervisor" else user.role.value
    try:
        msg = await chat_message_svc.send_client_message(
            db,
            thread=thread,
            user_id=user.id,
            role=author_role,
            client_request_id=body.client_request_id,
            text=body.text,
            message_type=body.message_type,
            image_data=body.image_data,
            reply_to_id=body.reply_to_id,
            additional_recipient_ids=extra_recipients,
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
