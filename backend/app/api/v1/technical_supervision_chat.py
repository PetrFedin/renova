from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.chats import MessageCreate
from app.db.session import get_db
from app.models.entities import User
from app.services import chat_service as chat_svc
from app.services.chat_acl import require_chat_access
from app.services import technical_supervision_action_service as actions
from app.services import technical_supervision_service as supervision

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
    author_role = "supervisor" if actor_mode == "supervisor" else user.role.value
    msg = await chat_svc.send_message(
        db,
        thread,
        user.id,
        author_role,
        body.text,
        body.message_type,
        body.image_data,
        body.reply_to_id,
    )
    await actions.notify_supervisor_chat_message(
        db,
        project=project,
        actor_id=user.id,
        thread_id=thread.id,
        thread_title=thread.title,
        body=body.text or "Вложение",
    )
    return chat_svc.msg_dict(msg)
