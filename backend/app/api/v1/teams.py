from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
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
    if code in {"team_owner_not_found", "team_not_found"}:
        return HTTPException(404, detail={"code": code})
    if code in {
        "invalid_team_name",
        "invalid_team_role",
        "invalid_invite_lifetime",
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


@router.post("/invite-sms")
async def invite_sms(
    body: SmsIn,
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
    from app.services.sms_service import send_sms

    message = await send_sms(body.phone, f"Renova: присоединяйтесь {link}")
    return {
        "ok": True,
        "link": link,
        "role": result.invite.role,
        "team_id": result.team.id,
        "team_replayed": result.team_replayed,
        **message,
    }


@router.post("/invite")
async def invite(
    body: InviteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    try:
        return await team_svc.invite_phone_as_owner(
            db,
            owner_id=user.id,
            phone=body.phone,
            role=body.role,
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


@router.post("/join")
async def join(
    body: JoinIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_contractor(user)
    return await team_svc.join_by_token(db, user.id, body.token)
