"""Execution proof issuer/verifier API.

Platform signatures attest canonical Renova ledger state only. They do not
impersonate contractor or customer electronic signatures.
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import execution_proof_trust_service as trust


router = APIRouter(prefix="/execution-trust", tags=["execution-trust"])


class VerifyIn(BaseModel):
    envelope: dict[str, Any]


class RevokeIn(BaseModel):
    checkpoint_sha256: str = Field(min_length=64, max_length=64)
    reason: str = Field(min_length=3, max_length=500)


@router.get("/public-key")
async def public_key():
    try:
        return trust.public_key_document()
    except trust.ExecutionIssuerNotConfigured as exc:
        raise HTTPException(
            503,
            detail={"code": exc.code, "message": "Execution proof issuer key is not configured"},
        ) from exc


@router.post("/projects/{project_id}/stages/{stage_id}/issue")
async def issue_checkpoint(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False, participant_ok=True, stage_id=stage_id)
    try:
        return await trust.issue_checkpoint(db, project_id=project_id, stage_id=stage_id)
    except trust.ExecutionIssuerNotConfigured as exc:
        raise HTTPException(
            503,
            detail={"code": exc.code, "message": "Execution proof issuer key is not configured"},
        ) from exc


@router.post("/verify")
async def verify_checkpoint(
    body: VerifyIn,
    db: AsyncSession = Depends(get_db),
):
    return await trust.verify_current_status(db, envelope=body.envelope)


@router.post("/revoke")
async def revoke_checkpoint(
    body: RevokeIn,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await trust.revoke_checkpoint(
            db,
            checkpoint_sha256=body.checkpoint_sha256,
            reason=body.reason,
            revoked_by=user.id,
        )
    except trust.InvalidExecutionCheckpoint as exc:
        raise HTTPException(
            422,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
