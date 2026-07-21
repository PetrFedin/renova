"""E-sign providers catalog + webhooks (Wave 3f)."""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import User
from app.services import project_document_service as docs_svc
from app.services.esign import list_providers

router = APIRouter(prefix="/esign", tags=["esign"])


class EsignWebhookIn(BaseModel):
    external_id: str = Field(min_length=4, max_length=128)
    status: str = "signed"  # signed | failed | pending
    meta: dict | None = None


def _check_webhook_secret(x_esign_secret: str | None) -> None:
    """Staging/prod + kontur/goskey on → secret обязателен. Dev — soft."""
    expected = (settings.esign_webhook_secret or "").strip()
    mode = (settings.kontur_mode or "off").strip().lower()
    env = settings.normalized_environment
    require = env in ("staging", "production") and mode in ("sandbox", "live")
    if require and not expected:
        raise HTTPException(
            503,
            "ESIGN_WEBHOOK_SECRET required when KONTUR_MODE=sandbox|live on staging/production",
        )
    if not expected:
        # Dev-friendly: allow without secret when not configured
        return
    if not x_esign_secret or x_esign_secret != expected:
        raise HTTPException(401, "invalid_webhook_secret")


def parse_esign_webhook_payload(raw: dict) -> tuple[str, str]:
    """Normalize Renova + Kontur-like payloads → (external_id, status)."""
    external_id = (
        raw.get("external_id")
        or raw.get("id")
        or (raw.get("object") or {}).get("id")
        or (raw.get("data") or {}).get("id")
        or (raw.get("signature") or {}).get("id")
    )
    status_raw = (
        raw.get("status")
        or (raw.get("object") or {}).get("status")
        or raw.get("event")
        or "signed"
    )
    status = str(status_raw).lower()
    if status in ("completed", "done", "success", "signed", "signature.completed"):
        status = "signed"
    elif status in ("failed", "error", "rejected", "signature.failed"):
        status = "failed"
    elif status not in ("signed", "failed", "pending"):
        status = "signed" if "sign" in status else status
    if not external_id or not isinstance(external_id, str) or len(external_id) < 4:
        raise HTTPException(400, "external_id_required")
    return external_id, status


async def _side_effects_after_external_sign(
    db,
    *,
    sig,
    provider: str,
) -> None:
    """Activity + notify when webhook sets signed_at."""
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
    proj = await db.get(Project, doc.project_id)
    if not proj:
        return
    for recipient_id in {proj.customer_id, proj.contractor_id, proj.foreman_id}:
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



async def _signature_webhook_payload(db, sig, *, provider: str, duplicate: bool) -> dict:
    from app.models.project_documents import ProjectDocument
    doc = await db.get(ProjectDocument, sig.document_id) if sig else None
    st = None
    if doc is not None:
        st = doc.status.value if hasattr(doc.status, "value") else str(doc.status)
    return {
        "ok": True,
        "duplicate": duplicate,
        "signature_id": sig.id,
        "status": sig.status,
        "signed_at": sig.signed_at.isoformat() if sig.signed_at else None,
        "provider": provider,
        "external_id": sig.provider_external_id,
        "document_id": sig.document_id,
        "document_status": st,
    }


@router.get("/health")
async def esign_health(_user: User = Depends(get_current_user)):
    """P3-W11: staging probe — kontur mode + webhook URLs для DevOps."""
    base = (settings.public_base_url or "http://127.0.0.1:8100").rstrip("/")
    secret_set = bool(settings.esign_webhook_secret)
    mode = (settings.kontur_mode or "off").strip().lower()
    env = settings.normalized_environment
    configured = bool(settings.kontur_api_key) and mode in ("sandbox", "live")
    live_ready = configured and secret_set and env in ("staging", "production", "development", "test")
    return {
        "environment": env,
        "kontur_mode": mode,
        "kontur_configured": configured,
        "live_webhook_ready": bool(configured and secret_set),
        "webhook_kontur": f"{base}/api/v1/esign/webhooks/kontur",
        "webhook_goskey": f"{base}/api/v1/esign/webhooks/goskey",
        "esign_webhook_secret_set": secret_set,
        "dev_simulate": f"{base}/api/v1/esign/dev/kontur/simulate",
        "hint": (
            None
            if live_ready or mode in ("", "off")
            else "Задайте KONTUR_API_KEY + KONTUR_MODE + ESIGN_WEBHOOK_SECRET"
        ),
        "providers": list_providers(),
    }


@router.get("/providers")
async def esign_providers(_user: User = Depends(get_current_user)):
    """Список провайдеров подписи: available зависит от env (KONTUR_*/GOSKEY_*)."""
    return {"providers": list_providers()}


@router.post("/webhooks/kontur")
async def kontur_webhook(
    body: dict,
    db: AsyncSession = Depends(get_db),
    x_esign_secret: str | None = Header(default=None, alias="X-Esign-Secret"),
):
    """Accept Renova EsignWebhookIn or Kontur-like {id,status,object}."""
    _check_webhook_secret(x_esign_secret)
    from sqlalchemy import select
    from app.models.project_documents import DocumentSignature

    external_id, status = parse_esign_webhook_payload(body if isinstance(body, dict) else {})
    existing = (
        await db.execute(
            select(DocumentSignature).where(
                DocumentSignature.provider_name == "kontur",
                DocumentSignature.provider_external_id == external_id,
            )
        )
    ).scalar_one_or_none()
    already_signed = bool(existing and existing.status == "signed" and existing.signed_at)
    sig = await docs_svc.complete_external_signature(
        db,
        provider_name="kontur",
        external_id=external_id,
        status=status,
    )
    if not sig:
        raise HTTPException(404, "signature_not_found")
    if status == "signed" and not already_signed:
        await _side_effects_after_external_sign(db, sig=sig, provider="kontur")
    await db.commit()
    return await _signature_webhook_payload(
        db, sig, provider="kontur", duplicate=already_signed and status == "signed"
    )


@router.post("/webhooks/goskey")
async def goskey_webhook(
    body: dict,
    db: AsyncSession = Depends(get_db),
    x_esign_secret: str | None = Header(default=None, alias="X-Esign-Secret"),
):
    _check_webhook_secret(x_esign_secret)
    external_id, status = parse_esign_webhook_payload(body if isinstance(body, dict) else {})
    already = False
    from sqlalchemy import select
    from app.models.project_documents import DocumentSignature
    existing = (
        await db.execute(
            select(DocumentSignature).where(
                DocumentSignature.provider_name == "goskey",
                DocumentSignature.provider_external_id == external_id,
            )
        )
    ).scalar_one_or_none()
    already = bool(existing and existing.status == "signed" and existing.signed_at)
    sig = await docs_svc.complete_external_signature(
        db,
        provider_name="goskey",
        external_id=external_id,
        status=status,
    )
    if not sig:
        raise HTTPException(404, "signature_not_found")
    if status == "signed" and not already:
        await _side_effects_after_external_sign(db, sig=sig, provider="goskey")
    await db.commit()
    return await _signature_webhook_payload(
        db, sig, provider="goskey", duplicate=already and status == "signed"
    )

@router.post("/dev/kontur/simulate")
async def dev_kontur_simulate(
    body: EsignWebhookIn,
    db: AsyncSession = Depends(get_db),
):
    """Development only: завершить pending подпись без внешнего Kontur."""
    if settings.normalized_environment not in ("development", "test"):
        raise HTTPException(404, "not_available")
    sig = await docs_svc.complete_external_signature(
        db,
        provider_name="kontur",
        external_id=body.external_id,
        status=body.status or "signed",
    )
    if not sig:
        raise HTTPException(404, "signature_not_found")
    await db.commit()
    return {"ok": True, "signature_id": sig.id, "simulated": True}

