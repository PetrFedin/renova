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


async def get_usable_link(
    db: AsyncSession,
    jti: str | None,
    *,
    for_decision: bool = False,
) -> PortalLink | None:
    """Read active registry entry; decision writers lock its row until their commit.

    populate_existing prevents an already-loaded ORM instance from hiding a
    concurrent transaction's committed consumption state after FOR UPDATE waits.
    """
    if not jti:
        return None
    if for_decision:
        statement = (
            select(PortalLink)
            .where(PortalLink.id == jti)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        link = (await db.execute(statement)).scalar_one_or_none()
    else:
        link = await db.get(PortalLink, jti)
    if link is None or link.revoked_at is not None:
        return None
    if link.expires_at <= utc_now():
        return None
    return link


def consume_accept_stage(
    link: PortalLink,
    *,
    acceptance_id: str,
    decision: str,
) -> None:
    """Called ONLY inside a successful locked acceptance transaction, pre-commit."""
    if link.accept_stage_consumed_at is not None:
        raise ValueError("portal_decision_already_used")
    if decision not in {"accept", "return"}:
        raise ValueError("portal_decision_invalid")
    link.accept_stage_consumed_at = utc_now()
    link.accept_stage_acceptance_id = acceptance_id
    link.accept_stage_decision = decision



def effective_portal_scopes(claims: dict, link: PortalLink | None) -> list[str]:
    """Client-facing capabilities: signed scope AND live registry scope.

    Legacy jti-less magic links can view (if signed for read), never write.
    A consumed acceptance right is omitted from the projection, while other
    rights on the same live link remain available.
    """
    signed = list(dict.fromkeys(claims.get("scopes") or ["read"]))
    if link is None:
        return ["read"] if "read" in signed else []
    registered = set((link.scopes or "").split(","))
    return [
        scope for scope in signed
        if scope in registered
        and (scope != "accept_stage" or link.accept_stage_consumed_at is None)
    ]


async def link_is_usable(db: AsyncSession, jti: str | None) -> bool:
    """Legacy read tokens without jti live to token exp; registered links must remain active."""
    if not jti:
        return True
    return await get_usable_link(db, jti) is not None


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
        "accept_stage_consumed_at": (link.accept_stage_consumed_at.isoformat() if link.accept_stage_consumed_at else None),
        "accept_stage_acceptance_id": link.accept_stage_acceptance_id,
        "accept_stage_decision": link.accept_stage_decision,
        "accept_stage_available": (
            "accept_stage" in (link.scopes or "").split(",")
            and link.revoked_at is None
            and link.expires_at > utc_now()
            and link.accept_stage_consumed_at is None
        ),
    }
