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
    expected = settings.esign_webhook_secret
    if not expected:
        # Dev-friendly: allow without secret when not configured
        return
    if not x_esign_secret or x_esign_secret != expected:
        raise HTTPException(401, "invalid_webhook_secret")


@router.get("/providers")
async def esign_providers(_user: User = Depends(get_current_user)):
    """Список провайдеров подписи: available зависит от env (KONTUR_*/GOSKEY_*)."""
    return {"providers": list_providers()}


@router.post("/webhooks/kontur")
async def kontur_webhook(
    body: EsignWebhookIn,
    db: AsyncSession = Depends(get_db),
    x_esign_secret: str | None = Header(default=None, alias="X-Esign-Secret"),
):
    _check_webhook_secret(x_esign_secret)
    from sqlalchemy import select
    from app.models.project_documents import DocumentSignature

    existing = (
        await db.execute(
            select(DocumentSignature).where(
                DocumentSignature.provider_name == "kontur",
                DocumentSignature.provider_external_id == body.external_id,
            )
        )
    ).scalar_one_or_none()
    already_signed = bool(existing and existing.status == "signed" and existing.signed_at)
    sig = await docs_svc.complete_external_signature(
        db,
        provider_name="kontur",
        external_id=body.external_id,
        status=body.status,
    )
    if not sig:
        raise HTTPException(404, "signature_not_found")
    await db.commit()
    return {
        "ok": True,
        "duplicate": already_signed and body.status == "signed",
        "signature_id": sig.id,
        "status": sig.status,
        "provider": "kontur",
        "external_id": sig.provider_external_id,
    }


@router.post("/webhooks/goskey")
async def goskey_webhook(
    body: EsignWebhookIn,
    db: AsyncSession = Depends(get_db),
    x_esign_secret: str | None = Header(default=None, alias="X-Esign-Secret"),
):
    _check_webhook_secret(x_esign_secret)
    sig = await docs_svc.complete_external_signature(
        db,
        provider_name="goskey",
        external_id=body.external_id,
        status=body.status,
    )
    if not sig:
        raise HTTPException(404, "signature_not_found")
    await db.commit()
    return {
        "ok": True,
        "signature_id": sig.id,
        "status": sig.status,
        "provider": "goskey",
        "external_id": sig.provider_external_id,
    }

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

