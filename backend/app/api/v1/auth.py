from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.schemas.auth import DemoLoginRequest, RegisterRequest, UserOut, SmsSendRequest, SmsVerifyRequest, RefreshRequest
from app.services.seed_demo import DEMO_PHONES
from app.services.fns.status_npd import check_taxpayer_npd_status
from app.core.security import create_access_token
from app.services.auth_audit import log_auth_event
from app.core.config import settings
from app.core.environment import policy_for


def _demo_endpoints_allowed() -> bool:
    if settings.allow_demo_seed is not None:
        return bool(settings.allow_demo_seed)
    return policy_for(settings.normalized_environment).allow_demo_seed


def _open_registration_allowed() -> bool:
    """Register without OTP — only local/test. Staging/prod → sms/verify."""
    return settings.normalized_environment in ("development", "test")


router = APIRouter(prefix="/auth", tags=["auth"])

async def user_out_with_token(
    user: User,
    db=None,
    *,
    device_id: str | None = None,
    issue_refresh: bool = True,
) -> UserOut:
    """UserOut + JWT access; refresh только на login (не на каждый /me)."""
    out = UserOut.model_validate(user, from_attributes=True)
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    out.access_token = create_access_token(user.id, {"role": role})
    out.token_type = "bearer"
    if issue_refresh and db is not None:
        from app.services import session_service as sess_svc
        _, raw = await sess_svc.create_session(db, user.id, device_id=device_id)
        out.refresh_token = raw
    return out


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
    """Soft-delete + anonymize + revoke sessions (P2.21). Hard purge = retention job later."""
    from datetime import datetime, timedelta
    from app.services import session_service as sess_svc

    now = datetime.utcnow()
    user.deletion_requested_at = now
    user.deleted_at = now
    user.tokens_invalid_before = now
    user.phone = f"deleted-{user.id[:8]}"
    user.full_name = "Deleted"
    user.inn = None
    user.moy_nalog_linked = False
    user.moy_nalog_status = "revoked"
    await sess_svc.revoke_all_user_sessions(db, user.id)
    await db.commit()
    return {
        "ok": True,
        "soft_deleted": True,
        "retention_until": (now + timedelta(days=30)).isoformat() + "Z",
    }


@router.post("/ws-ticket")
async def mint_ws_ticket(user: User = Depends(get_current_user)):
    """Short-lived WS ticket — prefer over long JWT in query string (P2.20)."""
    from app.services.ws_ticket_service import issue_ws_ticket

    ticket, ttl = issue_ws_ticket(user.id)
    return {"ticket": ticket, "expires_in": ttl, "token_type": "ws_ticket"}





@router.post("/sms/send")
async def sms_send(body: SmsSendRequest):
    from app.services.otp_service import send_otp
    result = await send_otp(body.phone)
    if not result.get("ok"):
        code = 429 if result.get("rate_limited") or result.get("locked") else 400
        raise HTTPException(code, result.get("message") or "otp_send_failed")
    return result


@router.post("/sms/verify", response_model=UserOut)
async def sms_verify(body: SmsVerifyRequest, db: AsyncSession = Depends(get_db)) -> UserOut:
    from app.services.otp_service import verify_otp
    if not verify_otp(body.phone, body.code):
        await log_auth_event(db, user_id=None, path="/auth/sms/verify", status_code=400, note="bad_otp")
        raise HTTPException(400, "Неверный или просроченный код")
    result = await db.execute(select(User).where(User.phone == body.phone))
    user = result.scalar_one_or_none()
    if user and getattr(user, "deleted_at", None):
        raise HTTPException(403, "account_deleted")
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
    out = await user_out_with_token(user, db)
    await log_auth_event(db, user_id=user.id, path="/auth/sms/verify", status_code=200, note="login_ok")
    return out

@router.post("/register", response_model=UserOut)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> UserOut:
    if not _open_registration_allowed():
        raise HTTPException(403, "registration_via_sms_only")
    result = await db.execute(select(User).where(User.phone == body.phone))
    existing = result.scalar_one_or_none()
    if existing:
        # Never mint JWT for existing user without OTP proof
        raise HTTPException(409, "user_exists_use_sms")

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
    return await user_out_with_token(user, db)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserOut:
    from app.services import chat_service as chat_svc
    if not user.profile_code:
        chat_svc.ensure_profile_code(user)
        await db.commit()
        await db.refresh(user)
    # Fresh access only — не плодим user_sessions на каждый poll /me
    return await user_out_with_token(user, db, issue_refresh=False)


@router.post("/demo", response_model=UserOut)
async def demo_login(body: DemoLoginRequest, db: AsyncSession = Depends(get_db)) -> UserOut:
    if not _demo_endpoints_allowed():
        raise HTTPException(404, "demo_disabled")
    if body.role not in DEMO_PHONES or body.role == "guest":
        raise HTTPException(400, "Доступны роли: customer, contractor")
    phone = DEMO_PHONES[body.role]
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Запустите backend — демо-данные создаются при старте")
    out = await user_out_with_token(user, db)
    await log_auth_event(db, user_id=user.id, path="/auth/demo", status_code=200, note="demo_login_ok")
    return out


@router.post("/demo/guest", response_model=UserOut)
async def demo_guest(db: AsyncSession = Depends(get_db)) -> UserOut:
    """Гостевой read-only доступ — заказчик с project_viewers, не отдельная роль."""
    if not _demo_endpoints_allowed():
        raise HTTPException(404, "demo_disabled")
    phone = DEMO_PHONES["guest"]
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Запустите backend — демо-данные создаются при старте")
    return await user_out_with_token(user, db)


@router.post("/refresh", response_model=UserOut)
async def refresh_tokens(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> UserOut:
    """Rotate refresh token and mint new access JWT."""
    from app.services import session_service as sess_svc
    rotated = await sess_svc.rotate_session(db, body.refresh_token)
    if not rotated:
        await log_auth_event(db, user_id=None, path="/auth/refresh", status_code=401, note="bad_refresh")
        raise HTTPException(401, "invalid_or_expired_refresh")
    sess, raw = rotated
    user = await db.get(User, sess.user_id)
    if not user:
        raise HTTPException(401, "user_not_found")
    if getattr(user, "deleted_at", None):
        raise HTTPException(401, "account_deleted")
    out = UserOut.model_validate(user, from_attributes=True)
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    out.access_token = create_access_token(user.id, {"role": role})
    out.refresh_token = raw
    out.token_type = "bearer"
    return out


@router.post("/logout")
async def logout_session(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    from app.services import session_service as sess_svc
    await sess_svc.revoke_session(db, body.refresh_token)
    return {"ok": True}


@router.post("/sessions/revoke-all")
async def revoke_all_sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P1.8: выйти на всех устройствах (revoke refresh + invalidate access via epoch)."""
    from datetime import datetime
    from app.services import session_service as sess_svc

    n = await sess_svc.revoke_all_user_sessions(db, user.id)
    user.tokens_invalid_before = datetime.utcnow()
    await db.commit()
    return {"ok": True, "revoked": n, "access_invalidated": True}


@router.post("/admin/purge-deleted-accounts")
async def purge_deleted_accounts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ops: hard-delete users soft-deleted >30d. Only staging/prod with ALLOW_ACCOUNT_PURGE=1."""
    from app.core.config import settings
    if not getattr(settings, "allow_account_purge", False):
        raise HTTPException(403, "account_purge_disabled")
    # Restrict to same phone pattern as demo admin — require contractor+explicit flag is weak;
    # use env gate only + caller must be authenticated (audit log).
    from app.services.account_purge_service import purge_deleted_users
    from app.services.auth_audit import log_auth_event

    n = await purge_deleted_users(db)
    await log_auth_event(db, user_id=user.id, path="/auth/admin/purge-deleted-accounts", status_code=200, note=f"purged={n}")
    return {"ok": True, "purged": n, "retention_days": 30}
