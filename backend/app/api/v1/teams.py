from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import team_service as team_svc

router = APIRouter(prefix="/teams", tags=["teams"])

class TeamIn(BaseModel):
    name: str

class InviteIn(BaseModel):
    phone: str
    role: str = "member"

class JoinIn(BaseModel):
    token: str

@router.get("/me")
async def my_team(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    t = await team_svc.my_team(db, user.id)
    if not t:
        return None
    return {"id": t.id, "name": t.name, "members": await team_svc.list_members(db, t.id)}

@router.post("")
async def create_team(body: TeamIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    t = await team_svc.create_team(db, user.id, body.name)
    return {"id": t.id, "name": t.name}

class SmsIn(BaseModel):
    phone: str

@router.post("/invite-sms")
async def invite_sms(body: SmsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = await team_svc.my_team(db, user.id)
    if not t or t.owner_id != user.id:
        raise HTTPException(403)
    link = await team_svc.create_invite_link(db, t.id)
    from app.services.sms_service import send_sms
    msg = await send_sms(body.phone, f"Renova: присоединяйтесь {link['link']}")
    return {"ok": True, "link": link["link"], **msg}

@router.post("/invite")
async def invite(body: InviteIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    t = await team_svc.my_team(db, user.id)
    if not t or t.owner_id != user.id:
        raise HTTPException(403)
    return await team_svc.invite_phone(db, t.id, body.phone, body.role)

@router.post("/invite-link")
async def invite_link(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    t = await team_svc.my_team(db, user.id)
    if not t or t.owner_id != user.id:
        raise HTTPException(403)
    return await team_svc.create_invite_link(db, t.id)

class RoleIn(BaseModel):
    user_id: str
    role: str

@router.patch("/member-role")
async def member_role(body: RoleIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = await team_svc.my_team(db, user.id)
    if not t:
        raise HTTPException(404)
    if not await team_svc.set_member_role(db, t.id, user.id, body.user_id, body.role):
        raise HTTPException(403)
    return {"ok": True}

@router.post("/join")
async def join(body: JoinIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    return await team_svc.join_by_token(db, user.id, body.token)
