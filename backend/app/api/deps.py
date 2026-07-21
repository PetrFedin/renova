"""API dependencies — JWT Bearer (SoT); X-User-Id only in allow_header profiles."""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import bearer_user_id
from app.db.session import get_db
from app.models.entities import Project, User
from app.services import project_service as proj_svc
from app.services import team_service as team_svc


async def resolve_user_id(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> str:
    """Resolve authenticated user id from Bearer JWT (preferred) or legacy header."""
    if authorization:
        try:
            uid = bearer_user_id(authorization)
        except JWTError:
            raise HTTPException(401, "Недействительный или просроченный токен") from None
        if uid:
            return uid
        raise HTTPException(401, "Недействительный Authorization")

    if x_user_id:
        if not settings.allow_header_user_id:
            raise HTTPException(
                401,
                "X-User-Id отключён. Используйте Authorization: Bearer <access_token>",
            )
        return x_user_id

    if settings.allow_header_user_id:
        raise HTTPException(401, "Требуется Authorization Bearer или X-User-Id")
    raise HTTPException(401, "Требуется Authorization: Bearer <access_token>")


async def get_current_user(
    user_id: str = Depends(resolve_user_id),
    db: AsyncSession = Depends(get_db),
) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    return user


async def require_project(
    db: AsyncSession, project_id: str, user: User, *, write: bool = False
) -> Project:
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
