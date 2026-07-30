"""E-sign providers catalog and fail-closed external webhooks."""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.models.project_documents import DocumentSignature
from app.services import project_document_service as docs_svc
from app.services.esign import list_providers

router = APIRouter(prefix="/esign", tags=["esign"])

_SIGNED_STATUSES = frozenset({"completed", "done", "success", "signed", "signature.completed"})
_FAILED_STATUSES = frozenset({"failed", "error", "rejected", "cancelled", "canceled", "signature.failed"})
_PENDING_STATUSES = frozenset({
    "pending",
    "created",
    "accepted",
    "sent",
    "processing",
    "awaiting_signature",
    "signature.pending",
})


class EsignWebhookIn(BaseModel):
    external_id: str = Field(min_length=4, max_length=128)
    status: str
    meta: dict | None = None


def _provider_mode(provider: str) -> str:
    if provider == "kontur":
        return (settings.kontur_mode or "off").strip().lower()
    if provider == "goskey":
        return (settings.goskey_mode or "off").strip().lower()
    return "off"


def _check_webhook_secret(provider: str, supplied: str | None) -> None:
    """External callbacks always require an explicitly configured shared secret."""
    expected = (settings.esign_webhook_secret or "").strip()
    if not expected:
        raise HTTPException(503, "esign_webhook_secret_missing")
    candidate = supplied or ""
    if not hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(401, "invalid_webhook_secret")
    if _provider_mode(provider) not in {"sandbox", "live"}:
        raise HTTPException(409, f"provider_{provider}_disabled")


def parse_esign_webhook_payload(raw: dict) -> tuple[str, str]:
    """Normalize only explicit, known provider statuses to a safe state."""
    external_id = (
        raw.get("external_id")
        or raw.get("id")
        or (raw.get("object") or {}).get("id")
        or (raw.get("data") or {}).get("id")
        or (raw.get("signature") or {}).get("id")
    )
    if (
        not isinstance(external_id, str)
        or not 4 <= len(external_id) <= 128
        or any(char in external_id for char in "\r\n\x00")
    ):
        raise HTTPException(400, "external_id_required")

    status_raw = raw.get("status") or (raw.get("object") or {}).get("status") or raw.get("event")
    if not isinstance(status_raw, str) or not status_raw.strip():
        raise HTTPException(400, "status_required")
    provider_status = status_raw.strip().lower()
    if provider_status in _SIGNED_STATUSES:
        status = "signed"
    elif provider_status in _FAILED_STATUSES:
        status = "failed"
    elif provider_status in _PENDING_STATUSES:
        status = "pending"
    else:
        raise HTTPException(400, "unsupported_esign_status")
    return external_id, status


async def _side_effects_after_external_sign(
    db: AsyncSession,
    *,
    sig: DocumentSignature,
    provider: str,
) -> None:
    """Activity + notification only after a first valid transition to signed."""
    if sig.status != "signed" or not sig.signed_at:
        return
    from app.models.entities import Project
    from app.models.project_documents import ProjectDocument
    from app.services import activity_service as act
    from app.services import notification_service as notif

    doc = await db.get(ProjectDocument, sig.document_id)
    if not doc:
        return
    await act.log_event(
        db,
        project_id=doc.project_id,
        user_id=sig.signer_user_id,
        kind="DocumentSignedExternal",
        title=f"Подпись {provider}: {doc.title}",
        body=sig.provider_external_id or "",
        link_path="/documents",
    )
    project = await db.get(Project, doc.project_id)
    if not project:
        return
    for recipient_id in {project.customer_id, project.contractor_id, project.foreman_id}:
        if not recipient_id or recipient_id == sig.signer_user_id:
            continue
        await notif.notify(
            db,
            user_id=recipient_id,
            project_id=doc.project_id,
            notification_type="document",
            title=f"Документ подписан ({provider}): {doc.title}",
            body="Внешняя подпись подтверждена",
            link_path="/documents",
            return_to="/documents",
        )


async def _signature_webhook_payload(
    db: AsyncSession,
    sig: DocumentSignature,
    *,
    provider: str,
    duplicate: bool,
) -> dict:
    from app.models.project_documents import ProjectDocument

    doc = await db.get(ProjectDocument, sig.document_id)
    document_status = None
    if doc is not None:
        document_status = doc.status.value if hasattr(doc.status, "value") else str(doc.status)
    return {
        "ok": True,
        "duplicate": duplicate,
        "signature_id": sig.id,
        "status": sig.status,
        "signed_at": sig.signed_at.isoformat() if sig.signed_at else None,
        "provider": provider,
        "external_id": sig.provider_external_id,
        "document_id": sig.document_id,
        "document_status": document_status,
    }


async def _process_provider_webhook(
    db: AsyncSession,
    *,
    provider: str,
    body: dict,
    supplied_secret: str | None,
) -> dict:
    _check_webhook_secret(provider, supplied_secret)
    external_id, status = parse_esign_webhook_payload(body if isinstance(body, dict) else {})
    existing_query = select(DocumentSignature).where(
        DocumentSignature.provider_name == provider,
        DocumentSignature.provider_external_id == external_id,
    )
    try:
        existing_query = existing_query.with_for_update()
    except Exception:
        pass
    existing = (await db.execute(existing_query)).scalar_one_or_none()
    if not existing:
        raise HTTPException(404, "signature_not_found")
    duplicate = status == existing.status and (
        status != "signed" or bool(existing.signed_at)
    )
    try:
        signature = await docs_svc.complete_external_signature(
            db,
            provider_name=provider,
            external_id=external_id,
            status=status,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    if not signature:
        raise HTTPException(404, "signature_not_found")
    if status == "signed" and not duplicate:
        await _side_effects_after_external_sign(db, sig=signature, provider=provider)
    await db.commit()
    return await _signature_webhook_payload(
        db,
        signature,
        provider=provider,
        duplicate=duplicate,
    )


@router.get("/health")
async def esign_health(_user: User = Depends(get_current_user)):
    base = (settings.public_base_url or "http://127.0.0.1:8100").rstrip("/")
    secret_set = bool((settings.esign_webhook_secret or "").strip())
    kontur_mode = _provider_mode("kontur")
    kontur_configured = (
        kontur_mode in {"sandbox", "live"}
        and bool((settings.kontur_api_key or "").strip())
        and bool((settings.kontur_api_url or "").strip())
        and secret_set
    )
    return {
        "environment": settings.normalized_environment,
        "kontur_mode": kontur_mode,
        "kontur_configured": kontur_configured,
        "goskey_mode": _provider_mode("goskey"),
        "goskey_configured": False,
        "live_webhook_ready": kontur_configured,
        "webhook_kontur": f"{base}/api/v1/esign/webhooks/kontur",
        "webhook_goskey": f"{base}/api/v1/esign/webhooks/goskey",
        "esign_webhook_secret_set": secret_set,
        "dev_simulate": (
            f"{base}/api/v1/esign/dev/kontur/simulate"
            if settings.normalized_environment in {"development", "test"}
            else None
        ),
        "hint": None if kontur_configured or kontur_mode == "off" else "Проверьте Kontur API URL/key и webhook secret",
        "providers": list_providers(),
    }


@router.get("/providers")
async def esign_providers(_user: User = Depends(get_current_user)):
    return {"providers": list_providers()}


@router.post("/webhooks/kontur")
async def kontur_webhook(
    body: dict,
    db: AsyncSession = Depends(get_db),
    x_esign_secret: str | None = Header(default=None, alias="X-Esign-Secret"),
):
    return await _process_provider_webhook(
        db,
        provider="kontur",
        body=body,
        supplied_secret=x_esign_secret,
    )


@router.post("/webhooks/goskey")
async def goskey_webhook(
    body: dict,
    db: AsyncSession = Depends(get_db),
    x_esign_secret: str | None = Header(default=None, alias="X-Esign-Secret"),
):
    return await _process_provider_webhook(
        db,
        provider="goskey",
        body=body,
        supplied_secret=x_esign_secret,
    )


@router.post("/dev/kontur/simulate")
async def dev_kontur_simulate(
    body: EsignWebhookIn,
    db: AsyncSession = Depends(get_db),
):
    if settings.normalized_environment not in {"development", "test"}:
        raise HTTPException(404, "not_available")
    external_id, status = parse_esign_webhook_payload(body.model_dump(exclude_none=True))
    try:
        signature = await docs_svc.complete_external_signature(
            db,
            provider_name="kontur",
            external_id=external_id,
            status=status,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    if not signature:
        raise HTTPException(404, "signature_not_found")
    await db.commit()
    return {
        "ok": True,
        "signature_id": signature.id,
        "status": signature.status,
        "simulated": True,
    }
