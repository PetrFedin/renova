from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.schemas.auth import DemoLoginRequest, RegisterRequest, UserOut, SmsSendRequest, SmsVerifyRequest
from app.services.seed_demo import DEMO_PHONES
from app.services.fns.status_npd import check_taxpayer_npd_status

router = APIRouter(prefix="/auth", tags=["auth"])

@router.get("/export")
async def export_my_data(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import Project
    r = await db.execute(select(Project).where((Project.customer_id == user.id) | (Project.contractor_id == user.id)))
    projects = [{"id": p.id, "name": p.name} for p in r.scalars().all()]
    return {"user": {"id": user.id, "phone": user.phone, "role": user.role.value}, "projects": projects}

@router.post("/anonymize")
async def anonymize_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.phone = f"deleted-{user.id[:8]}"
    user.full_name = "Deleted"
    user.inn = None
    await db.commit()
    return {"ok": True}

@router.delete("/me")
async def delete_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete
    from app.models.entities import Project
    if user.role.value == "customer":
        await db.execute(delete(Project).where(Project.customer_id == user.id))
    else:
        r = await db.execute(select(Project).where(Project.contractor_id == user.id))
        for p in r.scalars().all():
            p.contractor_id = None
    await db.delete(user)
    await db.commit()
    return {"ok": True}





@router.post("/sms/send")
async def sms_send(body: SmsSendRequest):
    from app.services.otp_service import send_otp
    return await send_otp(body.phone)


@router.post("/sms/verify", response_model=UserOut)
async def sms_verify(body: SmsVerifyRequest, db: AsyncSession = Depends(get_db)) -> UserOut:
    from app.services.otp_service import verify_otp
    if not verify_otp(body.phone, body.code):
        raise HTTPException(400, "Неверный или просроченный код")
    result = await db.execute(select(User).where(User.phone == body.phone))
    user = result.scalar_one_or_none()
    if not user:
        npd_verified = False
        if body.role == "contractor" and body.inn and len(body.inn) == 12:
            try:
                r = await check_taxpayer_npd_status(body.inn)
                npd_verified = r["is_npd"]
            except Exception:
                npd_verified = False
        user = User(phone=body.phone, role=UserRole(body.role), full_name=body.full_name, inn=body.inn, npd_verified=npd_verified)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    from app.services import chat_service as chat_svc
    if not user.profile_code:
        chat_svc.ensure_profile_code(user)
        await db.commit()
        await db.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)

@router.post("/register", response_model=UserOut)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> UserOut:
    result = await db.execute(select(User).where(User.phone == body.phone))
    existing = result.scalar_one_or_none()
    if existing:
        return UserOut.model_validate(existing, from_attributes=True)

    npd_verified = False
    if body.role == "contractor" and body.inn and len(body.inn) == 12:
        try:
            r = await check_taxpayer_npd_status(body.inn)
            npd_verified = r["is_npd"]
        except Exception:
            npd_verified = False

    user = User(
        phone=body.phone,
        role=UserRole(body.role),
        full_name=body.full_name,
        inn=body.inn,
        npd_verified=npd_verified,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserOut:
    from app.services import chat_service as chat_svc
    if not user.profile_code:
        chat_svc.ensure_profile_code(user)
        await db.commit()
        await db.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


@router.post("/demo", response_model=UserOut)
async def demo_login(body: DemoLoginRequest, db: AsyncSession = Depends(get_db)) -> UserOut:
    if body.role not in DEMO_PHONES or body.role == "guest":
        raise HTTPException(400, "Доступны роли: customer, contractor")
    phone = DEMO_PHONES[body.role]
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Запустите backend — демо-данные создаются при старте")
    return UserOut.model_validate(user, from_attributes=True)


@router.post("/demo/guest", response_model=UserOut)
async def demo_guest(db: AsyncSession = Depends(get_db)) -> UserOut:
    """Гостевой read-only доступ — заказчик с project_viewers, не отдельная роль."""
    phone = DEMO_PHONES["guest"]
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Запустите backend — демо-данные создаются при старте")
    return UserOut.model_validate(user, from_attributes=True)
