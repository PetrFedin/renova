"""Atomic OTP login/registration lifecycle."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.entities import AuditLog, User, UserRole
from app.services import chat_participant_service, chat_service, session_service


@dataclass(frozen=True)
class OtpLoginResult:
    user: User
    access_token: str
    refresh_token: str
    created: bool


async def complete_otp_login(
    db: AsyncSession,
    *,
    phone: str,
    role: str,
    full_name: str | None,
    inn: str | None,
    device_id: str | None,
    ip: str | None,
    user_agent: str | None,
    npd_verified: bool = False,
) -> OtpLoginResult:
    """Persist user bootstrap, chat invites, session and audit in one commit."""
    created = False
    try:
        query = select(User).where(User.phone == phone)
        try:
            query = query.with_for_update()
        except Exception:
            pass
        user = (await db.execute(query)).scalar_one_or_none()
        if user is not None and user.deleted_at is not None:
            raise ValueError("account_deleted")
        if user is None:
            user = User(
                phone=phone,
                role=UserRole(role),
                full_name=full_name,
                inn=inn,
                npd_verified=npd_verified,
            )
            db.add(user)
            await db.flush()
            created = True
        if not user.profile_code:
            chat_service.ensure_profile_code(user)
        # Phone-only chat invitations are a thread-scoped capability. Linking
        # them here makes SMS invite -> OTP registration -> inbox one atomic
        # identity transition without granting access to the whole project.
        await chat_participant_service.activate_pending_phone_invitations(db, user)
        _session, refresh_token = await session_service.create_session(
            db,
            user.id,
            device_id=device_id,
            ip=ip,
            user_agent=user_agent,
            commit=False,
        )
        db.add(
            AuditLog(
                user_id=user.id,
                method="AUTH",
                path="/auth/sms/verify|login_ok",
                status_code=200,
            )
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(user)
    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    return OtpLoginResult(
        user=user,
        access_token=create_access_token(user.id, {"role": role_value}),
        refresh_token=refresh_token,
        created=created,
    )
