"""Private manual-transfer evidence API bound to Payment and Project truth."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import admin_access_state, require_admin_user
from app.api.deps import get_current_user, require_project
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import payment_evidence_service as evidence_svc
from app.services import storage_service
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["payment-evidence"])


class UploadIntentIn(BaseModel):
    client_request_id: str = Field(min_length=16, max_length=80)
    original_filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=3, max_length=96)


class SubmitEvidenceIn(BaseModel):
    client_request_id: str = Field(min_length=16, max_length=80)


class ReviewEvidenceIn(BaseModel):
    client_request_id: str = Field(min_length=16, max_length=80)
    decision: str
    reason: str | None = Field(default=None, max_length=2000)


def _evidence_dict(row) -> dict:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "payment_id": row.payment_id,
        "version": row.version,
        "status": row.status,
        "original_filename": row.original_filename,
        "declared_content_type": row.declared_content_type,
        "verified_content_type": row.verified_content_type,
        "byte_size": row.byte_size,
        "sha256": row.sha256,
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "rejection_reason": row.rejection_reason,
    }


def _map_error(exc: Exception) -> HTTPException:
    code = str(exc)
    if isinstance(exc, IdempotencyConflict) or code == "idempotency_conflict":
        return HTTPException(409, detail={"code": "idempotency_conflict"})
    if code in {"payment_not_found", "evidence_not_found", "project_not_found"}:
        return HTTPException(404, detail={"code": code})
    if code in {"customer_required", "evidence_owner_mismatch"}:
        return HTTPException(403, detail={"code": code})
    if code in {"evidence_object_missing"}:
        return HTTPException(409, detail={"code": code, "retryable": True})
    if code in {"payment_terminal", "payment_not_pending_review", "active_evidence_exists", "evidence_not_upload_pending", "evidence_already_reviewed", "payment_confirmation_failed", "payment_unverified_transition_failed"}:
        return HTTPException(409, detail={"code": code})
    return HTTPException(422, detail={"code": code})


async def _assert_read_access(db: AsyncSession, project_id: str, user: User) -> None:
    is_admin, _ = admin_access_state(user)
    if is_admin:
        return
    await require_project(db, project_id, user, write=False)


@router.post("/{project_id}/payments/{payment_id}/evidence/upload-intent")
async def create_upload_intent(
    project_id: str, payment_id: str, body: UploadIntentIn,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        evidence, replayed = await evidence_svc.prepare_upload_intent(
            db, project_id=project_id, payment_id=payment_id, user=user,
            client_request_id=body.client_request_id, original_filename=body.original_filename,
            content_type=body.content_type,
        )
        external = storage_service.presigned_put(evidence.storage_key, content_type=evidence.declared_content_type)
    except (evidence_svc.PaymentEvidenceError, IdempotencyConflict) as exc:
        raise _map_error(exc) from exc
    except storage_service.StorageError as exc:
        raise HTTPException(503, detail={"code": str(exc), "retryable": True}) from exc
    local_path = f"/api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence.id}/content"
    return {
        **_evidence_dict(evidence),
        "replayed": replayed,
        "upload_url": external or f"{settings.public_base_url.rstrip('/')}{local_path}",
        "upload_method": "PUT",
        "upload_headers": {"Content-Type": evidence.declared_content_type},
        "external_presigned": bool(external),
    }


@router.put("/{project_id}/payments/{payment_id}/evidence/{evidence_id}/content")
async def upload_evidence_content(
    project_id: str, payment_id: str, evidence_id: str, request: Request,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer or project.customer_id != user.id:
        raise HTTPException(403, detail={"code": "customer_required"})
    evidence = await evidence_svc.get_evidence(db, evidence_id)
    if not evidence or evidence.project_id != project_id or evidence.payment_id != payment_id:
        raise HTTPException(404, detail={"code": "evidence_not_found"})
    if evidence.submitted_by != user.id:
        raise HTTPException(403, detail={"code": "evidence_owner_mismatch"})
    if evidence.status != "upload_pending":
        raise HTTPException(409, detail={"code": "evidence_not_upload_pending"})
    content_type = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if content_type != evidence.declared_content_type:
        raise HTTPException(422, detail={"code": "evidence_mime_mismatch"})
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > evidence_svc.MAX_EVIDENCE_BYTES:
            raise HTTPException(413, detail={"code": "evidence_too_large"})
        chunks.append(chunk)
    data = b"".join(chunks)
    try:
        evidence_svc.validate_evidence_bytes(data, declared_content_type=content_type)
        await storage_service.write_bytes_at_key(evidence.storage_key, data, content_type=content_type)
    except evidence_svc.PaymentEvidenceError as exc:
        raise _map_error(exc) from exc
    except storage_service.StorageError as exc:
        raise HTTPException(503, detail={"code": str(exc), "retryable": True}) from exc
    return {"evidence_id": evidence.id, "uploaded": True, "byte_size": len(data)}


@router.post("/{project_id}/payments/{payment_id}/evidence/{evidence_id}/submit")
async def submit_evidence(
    project_id: str, payment_id: str, evidence_id: str, body: SubmitEvidenceIn,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        evidence, replayed = await evidence_svc.submit_uploaded_evidence(
            db, project_id=project_id, payment_id=payment_id, evidence_id=evidence_id,
            user=user, client_request_id=body.client_request_id,
        )
    except (evidence_svc.PaymentEvidenceError, IdempotencyConflict) as exc:
        raise _map_error(exc) from exc
    except storage_service.StorageError as exc:
        raise HTTPException(503, detail={"code": str(exc), "retryable": True}) from exc
    return {**_evidence_dict(evidence), "replayed": replayed}


@router.get("/{project_id}/payments/{payment_id}/evidence")
async def list_evidence(
    project_id: str, payment_id: str, user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _assert_read_access(db, project_id, user)
    try:
        rows = await evidence_svc.list_payment_evidence(db, project_id=project_id, payment_id=payment_id)
    except evidence_svc.PaymentEvidenceError as exc:
        raise _map_error(exc) from exc
    return [_evidence_dict(row) for row in rows]


@router.get("/{project_id}/payments/{payment_id}/evidence/{evidence_id}/content")
async def read_evidence_content(
    project_id: str, payment_id: str, evidence_id: str,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await _assert_read_access(db, project_id, user)
    evidence = await evidence_svc.get_evidence(db, evidence_id)
    if not evidence or evidence.project_id != project_id or evidence.payment_id != payment_id:
        raise HTTPException(404, detail={"code": "evidence_not_found"})
    try:
        url = storage_service.presigned_url(evidence.storage_key)
        if url:
            return RedirectResponse(url, status_code=302, headers={"Cache-Control": "private, no-store"})
        data = await storage_service.read_bytes(evidence.storage_key)
    except storage_service.StorageError as exc:
        raise HTTPException(503, detail={"code": str(exc), "retryable": True}) from exc
    if data is None:
        raise HTTPException(404, detail={"code": "evidence_object_missing"})
    return Response(content=data, media_type=evidence.verified_content_type or evidence.declared_content_type, headers={"Cache-Control": "private, no-store"})


@router.post("/{project_id}/payments/{payment_id}/evidence/{evidence_id}/review")
async def review_evidence(
    project_id: str, payment_id: str, evidence_id: str, body: ReviewEvidenceIn,
    reviewer: User = Depends(require_admin_user), db: AsyncSession = Depends(get_db),
):
    try:
        evidence, replayed = await evidence_svc.review_evidence(
            db, project_id=project_id, payment_id=payment_id, evidence_id=evidence_id,
            reviewer=reviewer, decision=body.decision, reason=body.reason,
            client_request_id=body.client_request_id,
        )
    except (evidence_svc.PaymentEvidenceError, IdempotencyConflict) as exc:
        raise _map_error(exc) from exc
    return {**_evidence_dict(evidence), "replayed": replayed}
