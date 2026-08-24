"""Inbox чатов — project membership + exact invited threads."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, User
from app.services import chat_participant_service as participant_svc
from app.services import chat_service as chat_svc

router = APIRouter(prefix="/chats", tags=["chats-inbox"])


async def _user_projects(db: AsyncSession, user: User) -> list[tuple[str, str]]:
    r = await db.execute(
        select(Project).where((Project.customer_id == user.id) | (Project.contractor_id == user.id))
    )
    return [(p.id, p.name) for p in r.scalars().all()]


def _sort_inbox(items: list[dict]) -> list[dict]:
    items.sort(
        key=lambda item: (
            not item.get("is_pinned"),
            item.get("pinned_at") or "",
            item.get("updated_at") or "",
        ),
        reverse=True,
    )
    return items


@router.get("/inbox")
async def inbox(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    projects = await _user_projects(db, user)
    member_project_ids = {project_id for project_id, _name in projects}
    member_items = await chat_svc.list_inbox(db, user.id, projects)
    participant_items = await participant_svc.participant_inbox(
        db,
        user_id=user.id,
        exclude_project_ids=member_project_ids,
    )
    return _sort_inbox(member_items + participant_items)


@router.get("/unread-total")
async def unread_total(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    projects = await _user_projects(db, user)
    ids = [project_id for project_id, _name in projects]
    count = await chat_svc.count_unread_all(db, user.id, ids)
    count += await participant_svc.participant_unread_total(
        db,
        user_id=user.id,
        exclude_project_ids=set(ids),
    )
    return {"count": count}
