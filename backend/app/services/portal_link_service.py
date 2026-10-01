"""INB-04: реестр портал-ссылок — выдача, проверка, отзыв."""
from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import PortalLink
from app.services import portal_token_service as portal_tok

DEFAULT_TTL_HOURS = 168


async def issue_link(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    issued_by: str,
    scopes: list[str],
    ttl_hours: int = DEFAULT_TTL_HOURS,
) -> tuple[PortalLink, str]:
    link_id = str(uuid.uuid4())
    now = utc_now()
    link = PortalLink(
        id=link_id,
        project_id=project_id,
        user_id=user_id,
        issued_by=issued_by,
        scopes=",".join(scopes),
        created_at=now,
        expires_at=now + timedelta(hours=ttl_hours),
    )
    db.add(link)
    await db.commit()
    token = portal_tok.create_portal_token(
        project_id=project_id, user_id=user_id, ttl_hours=ttl_hours, scopes=scopes, jti=link_id
    )
    return link, token


async def link_is_usable(db: AsyncSession, jti: str | None) -> bool:
    """Токены без jti (выданы до реестра) живут до exp; с jti — только пока ссылка не отозвана."""
    if not jti:
        return True
    link = await db.get(PortalLink, jti)
    return link is not None and link.revoked_at is None


async def list_active_links(db: AsyncSession, project_id: str, *, issued_by: str | None = None) -> list[PortalLink]:
    stmt = select(PortalLink).where(
        PortalLink.project_id == project_id,
        PortalLink.revoked_at.is_(None),
        PortalLink.expires_at > utc_now(),
    )
    if issued_by is not None:
        stmt = stmt.where(PortalLink.issued_by == issued_by)
    return list((await db.execute(stmt.order_by(PortalLink.created_at.desc()))).scalars().all())


async def revoke_link(db: AsyncSession, link: PortalLink, *, commit: bool = True) -> None:
    if link.revoked_at is None:
        link.revoked_at = utc_now()
        if commit:
            await db.commit()


async def revoke_links_for_user(db: AsyncSession, user_id: str) -> int:
    """Отозвать все активные ссылки, выданные пользователем или ведущие на него (без commit)."""
    res = await db.execute(
        update(PortalLink)
        .where(
            PortalLink.revoked_at.is_(None),
            or_(PortalLink.user_id == user_id, PortalLink.issued_by == user_id),
        )
        .values(revoked_at=utc_now())
    )
    return int(res.rowcount or 0)


def link_dict(link: PortalLink) -> dict:
    return {
        "id": link.id,
        "project_id": link.project_id,
        "user_id": link.user_id,
        "issued_by": link.issued_by,
        "scopes": [s for s in (link.scopes or "").split(",") if s],
        "created_at": link.created_at.isoformat() if link.created_at else None,
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
    }
