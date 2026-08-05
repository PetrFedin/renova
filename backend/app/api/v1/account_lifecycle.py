"""Canonical account deletion, session revocation and retention purge routes."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.api.deps import get_current_user
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.models.entities import User
from app.services import session_service
from app.services.account_lifecycle_service import soft_delete_account
from app.services.account_purge_guard import (
    AccountPurgeForbidden,
    AccountPurgeUnavailable,
    authorize_account_purge,
)
from app.services.auth_audit import log_auth_event

router = APIRouter(prefix="/auth", tags=["auth"])


class AccountPurgeRequest(BaseModel):
    confirm: Literal["PURGE_DELETED_ACCOUNTS"]
    older_than_days: int = Field(default=30, ge=30, le=3650)


@router.post("/anonymize")
async def anonymize_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Compatibility route: anonymization is a real soft-delete, not a live zombie account."""
    return await soft_delete_account(db, user)


@router.delete("/me")
async def delete_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await soft_delete_account(db, user)


@router.post("/sessions/revoke-all")
async def revoke_all_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke refresh tokens and invalidate access JWTs in one commit."""
    user.tokens_invalid_before = utc_now()
    try:
        revoked = await session_service.revoke_all_user_sessions(
            db,
            user.id,
            commit=False,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return {"ok": True, "revoked": revoked, "access_invalidated": True}


@router.post("/admin/purge-deleted-accounts")
async def purge_deleted_accounts(
    body: AccountPurgeRequest,
    ops_secret: str | None = Header(default=None, alias="X-Account-Purge-Secret"),
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Irreversible purge requires allowlisted admin identity plus ops secret."""
    try:
        authorize_account_purge(ops_secret)
    except AccountPurgeForbidden as exc:
        raise HTTPException(403, detail={"code": str(exc)}) from None
    except AccountPurgeUnavailable as exc:
        raise HTTPException(503, detail={"code": str(exc)}) from None

    from app.services.account_purge_service import purge_deleted_users

    purged = await purge_deleted_users(db, older_than_days=body.older_than_days)
    await log_auth_event(
        db,
        user_id=user.id,
        path="/auth/admin/purge-deleted-accounts",
        status_code=200,
        note=f"purged={purged};older_than_days={body.older_than_days}",
    )
    return {
        "ok": True,
        "purged": purged,
        "retention_days": body.older_than_days,
    }
