"""Platform-admin API for provider reconciliation inspection and recovery."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.db.session import get_db
from app.models.entities import User
from app.services.provider_reconciliation_admin_service import (
    ProviderReconciliationConflict,
    ProviderReconciliationNotFound,
    get_reconciliation,
    list_reconciliations,
    requeue_reconciliation,
)

router = APIRouter(prefix="/provider-reconciliations", tags=["admin-provider-operations"])


def _raise_service_error(exc: Exception) -> None:
    if isinstance(exc, ProviderReconciliationNotFound):
        raise HTTPException(404, detail={"code": exc.code}) from exc
    if isinstance(exc, ProviderReconciliationConflict):
        detail: dict[str, object] = {"code": exc.code}
        if exc.context:
            detail["context"] = exc.context
        raise HTTPException(409, detail=detail) from exc
    raise exc


@router.get("")
async def reconciliation_index(
    status: str | None = Query(None, min_length=1, max_length=16),
    provider: str | None = Query(None, min_length=1, max_length=32),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_reconciliations(
            db,
            status=status,
            provider=provider,
            limit=limit,
            offset=offset,
        )
    except ProviderReconciliationConflict as exc:
        _raise_service_error(exc)


@router.get("/{reconciliation_id}")
async def reconciliation_detail(
    reconciliation_id: str,
    _user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_reconciliation(db, reconciliation_id=reconciliation_id)
    except ProviderReconciliationNotFound as exc:
        _raise_service_error(exc)


@router.post("/{reconciliation_id}/requeue")
async def reconciliation_requeue(
    reconciliation_id: str,
    _user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await requeue_reconciliation(db, reconciliation_id=reconciliation_id)
    except (ProviderReconciliationNotFound, ProviderReconciliationConflict) as exc:
        _raise_service_error(exc)
