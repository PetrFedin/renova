from fastapi import APIRouter, Depends, HTTPException
from app.core.phone import InvalidPhoneNumber, normalize_phone
from app.core.rate_limit import RateLimitBackendUnavailable, rate_limiter
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import team_invite_join_service as team_join_svc
from app.services import team_service as team_svc

router = APIRouter(prefix="/teams", tags=["teams"])


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class InviteIn(BaseModel):
    phone: str = Field(min_length=3, max_length=20)
    role: str = "member"


class JoinIn(BaseModel):
    token: str = Field(min_length=1, max_length=128)


class InviteLinkIn(BaseModel):
    """Roles: member (работы), viewer (только просмотр), foreman (прораб)."""

    role: str = "member"


class SmsIn(BaseModel):
    phone: str = Field(min_length=3, max_length=20)
    role: str = "member"


class RoleIn(BaseModel):
    user_id: str
    role: str


def _team_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {"team_owner_contractor_only", "team_owner_only"}:
        return HTTPException(403, detail={"code": code})
    if code in {
        "team_owner_not_found",
        "team_not_found",
        "team_member_not_found",
        "invitation_not_found",
    }:
        return HTTPException(404, detail={"code": code})
    if code in {
        "invalid_team_name",
        "invalid_team_role",
        "invalid_invite_lifetime",
        "invalid_phone",
    }:
        return HTTPException(422, detail={"code": code})
    return HTTPException(409, detail={"code": code})


def _require_contractor(user: User) -> None:
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_only"})


@router.get("/me")
async def my_team(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    team = await team_svc.my_team(db, user.id)
    if not team:
        return None
    return {
        "id": team.id,
        "name": team.name,
        "owner_id": team.owner_id,
        "members": await team_svc.list_members(db, team.id),
    }


@router.post("")
async def create_team(
    body: TeamIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    try:
        result = await team_svc.create_or_get_team(db, user.id, body.name)
    except ValueError as error:
        raise _team_error(error) from error
    return {
        "id": result.team.id,
        "name": result.team.name,
        "replayed": result.replayed,
    }


# MKT-036: SMS шлёт только владелец бригады и не чаще, чем в сутки на пользователя/номер.
SMS_PER_USER_PER_DAY = 10
SMS_PER_PHONE_PER_DAY = 3
PHONE_INVITES_PER_USER_PER_DAY = 30
_DAY_SECONDS = 24 * 60 * 60


async def _enforce_daily_limit(prefix: str, identity: str, limit: int, code: str) -> None:
    try:
        decision = await rate_limiter.check(
            prefix, identity, limit=limit, window_seconds=_DAY_SECONDS,
        )
    except RateLimitBackendUnavailable as error:
        raise HTTPException(503, detail={"code": "rate_limit_unavailable"}) from error
    if not decision.allowed:
        raise HTTPException(
            429,
            detail={"code": code},
            headers={"Retry-After": str(decision.retry_after_seconds)},
        )


@router.post("/invite-sms")
async def invite_sms(
    body: SmsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    try:
        phone = normalize_phone(body.phone)
    except InvalidPhoneNumber as error:
        raise HTTPException(422, detail={"code": "invalid_phone"}) from error
    # Только владелец существующей бригады: SMS не создаёт команду и не доступен остальным.
    if await team_svc.owned_team(db, user.id) is None:
        raise HTTPException(403, detail={"code": "team_owner_only"})
    await _enforce_daily_limit("team-sms:user", user.id, SMS_PER_USER_PER_DAY, "sms_user_limit")
    await _enforce_daily_limit("team-sms:phone", phone, SMS_PER_PHONE_PER_DAY, "sms_phone_limit")
    try:
        result = await team_svc.create_owner_invite(
            db,
            owner_id=user.id,
            role=body.role,
            create_team=False,
        )
    except ValueError as error:
        raise _team_error(error) from error

    link = f"renova://team/join/{result.invite.token}"
    from app.services.sms_service import SmsError, send_sms

    try:
        message = await send_sms(phone, f"Renova: присоединяйтесь {link}")
    except SmsError as error:
        raise HTTPException(502, detail={"code": "sms_delivery_failed"}) from error
    return {
        "ok": True,
        "link": link,
        "role": result.invite.role,
        "team_id": result.team.id,
        "team_replayed": result.team_replayed,
        "delivered": message.delivered,
        "preview": message.preview,
    }


@router.post("/invite")
async def invite(
    body: InviteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Приглашение по телефону (MKT-022): создаёт ожидающее приглашение, не членство.

    Ответ нейтрален: «приглашение отправлено» и для незарегистрированного номера.
    Ошибки ввода: 422 ``invalid_phone``/``invalid_team_role``; «уже в бригаде» — 409.
    """
    _require_contractor(user)
    await _enforce_daily_limit(
        "team-invite:user", user.id, PHONE_INVITES_PER_USER_PER_DAY, "invite_user_limit",
    )
    try:
        result = await team_svc.invite_phone_as_owner(
            db,
            owner_id=user.id,
            phone=body.phone,
            role=body.role,
        )
    except ValueError as error:
        raise _team_error(error) from error
    if not result.get("ok"):
        status = 409 if result.get("code") == "already_member" else 422
        raise HTTPException(
            status,
            detail={"code": result.get("code", "invite_failed"), "message": result.get("message")},
        )
    return result


@router.get("/invitations")
async def my_invitations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Приглашения в бригады, ожидающие моего ответа."""
    _require_contractor(user)
    return {"items": await team_svc.list_pending_invitations(db, user.id)}


@router.get("/invites")
async def owner_invites(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Действующие приглашения моей бригады (MKT-012)."""
    _require_contractor(user)
    return {"items": await team_svc.list_owner_invites(db, user.id)}


@router.delete("/invites/{invite_id}")
async def revoke_invite(
    invite_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Владелец отзывает неиспользованное приглашение (MKT-012)."""
    _require_contractor(user)
    try:
        return await team_svc.revoke_invite_as_owner(db, owner_id=user.id, invite_id=invite_id)
    except ValueError as error:
        raise _team_error(error) from error


@router.post("/invitations/{invitation_id}/{decision}")
async def respond_invitation(
    invitation_id: str,
    decision: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    if decision not in {"accept", "decline"}:
        raise HTTPException(404, detail={"code": "invitation_not_found"})
    try:
        return await team_svc.respond_to_invitation(
            db,
            user_id=user.id,
            invitation_id=invitation_id,
            accept=decision == "accept",
        )
    except ValueError as error:
        raise _team_error(error) from error


@router.post("/invite-link")
async def invite_link(
    body: InviteLinkIn = InviteLinkIn(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    try:
        result = await team_svc.create_owner_invite(
            db,
            owner_id=user.id,
            role=body.role,
        )
    except ValueError as error:
        raise _team_error(error) from error
    link = f"renova://team/join/{result.invite.token}"
    return {
        "token": result.invite.token,
        "link": link,
        "role": result.invite.role,
        "team_id": result.team.id,
        "team_replayed": result.team_replayed,
    }


@router.patch("/member-role")
async def member_role(
    body: RoleIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    try:
        changed = await team_svc.set_member_role_as_owner(
            db,
            owner_id=user.id,
            user_id=body.user_id,
            role=body.role,
        )
    except ValueError as error:
        raise _team_error(error) from error
    if not changed:
        raise HTTPException(403, detail={"code": "team_role_change_forbidden"})
    return {"ok": True}


@router.delete("/members/{member_user_id}")
async def remove_member(
    member_user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Владелец бригады убирает участника (MKT-012)."""
    _require_contractor(user)
    try:
        return await team_svc.remove_member_as_owner(
            db, owner_id=user.id, user_id=member_user_id,
        )
    except ValueError as error:
        raise _team_error(error) from error


@router.post("/leave")
async def leave(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Участник сам выходит из бригады; владелец — нет (MKT-012)."""
    _require_contractor(user)
    try:
        return await team_svc.leave_team(db, user_id=user.id)
    except ValueError as error:
        raise _team_error(error) from error


@router.post("/join")
async def join(
    body: JoinIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    return await team_join_svc.join_by_token(db, user.id, body.token)
