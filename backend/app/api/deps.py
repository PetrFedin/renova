"""API dependencies — JWT Bearer (SoT); X-User-Id only in allow_header profiles."""
from __future__ import annotations

import logging

from fastapi import Depends, Header, HTTPException
from jwt.exceptions import InvalidTokenError as JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import bearer_user_id, decode_access_token
from app.db.session import get_db
from app.models.entities import Project, User
from app.services import project_service as proj_svc
from app.services import team_service as team_svc
from app.services.access_token_guard import (
    AccessTokenGuardError,
    AccessTokenRevoked,
    assert_access_token_not_revoked,
)

logger = logging.getLogger(__name__)


def _bearer_token(authorization: str) -> str:
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(401, "Недействительный Authorization")
    return parts[1].strip()


def _validate_access_session(
    authorization: str,
    *,
    user_id: str,
    invalid_before,
) -> None:
    token = _bearer_token(authorization)
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise HTTPException(401, "Недействительный или просроченный токен") from None
    except Exception:
        logger.exception("access token validation failed user_id=%s", user_id)
        raise HTTPException(401, "session_validation_failed") from None

    try:
        assert_access_token_not_revoked(
            payload,
            user_id=user_id,
            invalid_before=invalid_before,
        )
    except AccessTokenRevoked:
        raise HTTPException(401, "session_revoked") from None
    except AccessTokenGuardError as exc:
        raise HTTPException(401, str(exc)) from None


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
        except Exception:
            logger.exception("access token parsing failed")
            raise HTTPException(401, "token_validation_failed") from None
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
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db),
) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    if getattr(user, "deleted_at", None):
        raise HTTPException(401, "account_deleted")

    cutoff = getattr(user, "tokens_invalid_before", None)
    if cutoff is not None and authorization:
        _validate_access_session(
            authorization,
            user_id=user.id,
            invalid_before=cutoff,
        )
    return user


async def require_project(
    db: AsyncSession, project_id: str, user: User, *, write: bool = False
) -> Project:
    p = await proj_svc.get_project(db, project_id)
    if not p:
        raise HTTPException(404, "Проект не найден")

    has_access = await team_svc.can_access_project(db, user, p, write=write)
    if not has_access and not write:
        # Technical supervision is intentionally only a read fallback here.
        # Explicit technical writes use capability-checked canonical routes;
        # generic project writes remain closed.
        from app.services import technical_supervision_service as supervision

        has_access = await supervision.is_active_supervisor(
            db,
            project_id=p.id,
            user_id=user.id,
        )
    if not has_access:
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
