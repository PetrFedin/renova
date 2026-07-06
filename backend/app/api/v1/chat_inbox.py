"""Inbox чатов — все проекты пользователя."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, User
from app.services import chat_service as chat_svc

router = APIRouter(prefix="/chats", tags=["chats-inbox"])


async def _user_projects(db: AsyncSession, user: User) -> list[tuple[str, str]]:
    r = await db.execute(
        select(Project).where((Project.customer_id == user.id) | (Project.contractor_id == user.id))
    )
    return [(p.id, p.name) for p in r.scalars().all()]


@router.get("/inbox")
async def inbox(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    projects = await _user_projects(db, user)
    return await chat_svc.list_inbox(db, user.id, projects)


@router.get("/unread-total")
async def unread_total(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    projects = await _user_projects(db, user)
    ids = [p[0] for p in projects]
    count = await chat_svc.count_unread_all(db, user.id, ids)
    return {"count": count}
