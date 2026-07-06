from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import PushToken, User

router = APIRouter(prefix="/push", tags=["push"])

class TokenIn(BaseModel):
    token: str

@router.post("/register")
async def register_token(body: TokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(PushToken).where(PushToken.user_id == user.id, PushToken.token == body.token))
    if not r.scalar_one_or_none():
        db.add(PushToken(user_id=user.id, token=body.token))
        await db.commit()
    return {"ok": True}
