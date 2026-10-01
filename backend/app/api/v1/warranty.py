"""Canonical warranty mutations separated from the legacy export router."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import issue_service as issue_svc
from app.services import warranty_claim_service as warranty_svc
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["warranty"])


class WarrantyClaimIn(BaseModel):
    title: str = Field(default="Гарантийное обращение", min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    client_request_id: str = Field(min_length=8, max_length=80)


def _idempotency_http_error() -> HTTPException:
    return HTTPException(409, detail={"code": "warranty_claim_idempotency_conflict", "message": "Этот гарантийный запрос уже использован с другими данными"})


@router.post("/{project_id}/warranty-claims")
async def create_warranty_claim(project_id: str, body: WarrantyClaimIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    try:
        result = await warranty_svc.create_or_replay_warranty_claim(db, project=project, user_id=user.id, title=body.title, description=body.description, client_request_id=body.client_request_id)
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    except warranty_svc.WarrantyClaimTargetMissing as exc:
        raise HTTPException(409, detail={"code": "warranty_claim_idempotency_target_missing", "message": "Каноническое гарантийное обращение не найдено"}) from exc
    return result.response_dict()


class WarrantyRespondIn(BaseModel):
    decision: Literal["accept", "reject", "fixed"]
    comment: str | None = Field(default=None, max_length=1000)


class WarrantyReopenIn(BaseModel):
    comment: str | None = Field(default=None, max_length=1000)


@router.post("/{project_id}/warranty-claims/{issue_id}/respond")
async def respond_warranty_claim(project_id: str, issue_id: str, body: WarrantyRespondIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """QLT-004: ответ исполнителя — принял / отклонил с комментарием / отметил исправленным."""
    project = await require_project(db, project_id, user, write=True)
    issue = await warranty_svc.respond_to_claim(db, project=project, actor=user, issue_id=issue_id, decision=body.decision, comment=body.comment)
    return {"ok": True, "issue": issue_svc.issue_dict(issue)}


@router.post("/{project_id}/warranty-claims/{issue_id}/reopen")
async def reopen_warranty_claim(project_id: str, issue_id: str, body: WarrantyReopenIn | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """QLT-004: заказчик открывает обращение снова после закрытия/отказа."""
    project = await require_project(db, project_id, user, write=True)
    issue = await warranty_svc.reopen_claim(db, project=project, actor=user, issue_id=issue_id, comment=body.comment if body else None)
    return {"ok": True, "issue": issue_svc.issue_dict(issue)}
