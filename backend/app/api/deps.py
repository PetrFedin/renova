"""Зависимости API — MVP auth через заголовок X-User-Id."""
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.entities import User


async def get_current_user(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not x_user_id:
        raise HTTPException(401, "Требуется X-User-Id")
    result = await db.execute(select(User).where(User.id == x_user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    return user


from app.models.entities import Project
from app.services import project_service as proj_svc
from app.services import team_service as team_svc

async def require_project(db: AsyncSession, project_id: str, user: User, *, write: bool = False) -> Project:
    p = await proj_svc.get_project(db, project_id)
    if not p:
        raise HTTPException(404, "Проект не найден")
    if not await team_svc.can_access_project(db, user, p, write=write):
        raise HTTPException(403, "Нет доступа")
    if getattr(p, "trashed_at", None):
        raise HTTPException(404, "Проект в корзине")
    return p


def require_project_dep(write: bool = False):
    """FastAPI Depends-обёртка для require_project (совместимость роутов)."""
    async def _dep(
        project_id: str,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> Project:
        return await require_project(db, project_id, user, write=write)
    return _dep
