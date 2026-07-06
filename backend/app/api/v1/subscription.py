from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services.subscription_service import PRO_PRICE, activate_pro, get_sub, is_pro
from app.services.yookassa_service import create_payment, check_webhook_ip, remember_webhook
from app.core.config import settings

router = APIRouter(prefix="/subscription", tags=["subscription"])

@router.get("/me")
async def my_sub(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await get_sub(db, user.id)
    return {"plan": s.plan, "status": s.status.value, "expires_at": s.expires_at.isoformat() if s.expires_at else None, "is_pro": await is_pro(db, user.id), "price": PRO_PRICE, "free_limit": settings.contractor_free_project_limit}

@router.post("/checkout")
async def checkout(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    pay = await create_payment(PRO_PRICE, "Renova Pro — 30 дней", "http://127.0.0.1:8081/(contractor)/subscription", user.id, f"pro-{user.id}")
    if pay.get("demo"):
        await activate_pro(db, user.id)
        return {"ok": True, "demo": True, "message": "Pro активирован (demo)"}
    return pay

@router.post("/webhook")
async def yookassa_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """ЮKassa: payment.succeeded → activate Pro."""
    ip = request.client.host if request.client else None
    if not check_webhook_ip(ip):
        raise HTTPException(403, "ip denied")
    if settings.yookassa_webhook_secret and request.headers.get("X-Webhook-Secret") != settings.yookassa_webhook_secret:
        raise HTTPException(401, "invalid webhook")
    body = await request.json()
    eid = body.get('object', {}).get('id') or body.get('event', '')
    if eid and not remember_webhook(str(eid)):
        return {"ok": True, "duplicate": True}
    event = body.get("event")
    obj = body.get("object") or {}
    if event == "payment.succeeded" and obj.get("status") == "succeeded":
        uid = (obj.get("metadata") or {}).get("user_id")
        if uid:
            await activate_pro(db, uid)
    return {"ok": True}
