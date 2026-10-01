from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import PushToken, User
from app.services.push_service import normalize_expo_push_token

router = APIRouter(prefix="/push", tags=["push"])


class TokenIn(BaseModel):
    token: str

    @field_validator("token")
    @classmethod
    def validate_token(cls, value: str) -> str:
        return normalize_expo_push_token(value)


@router.post("/register")
async def register_token(
    body: TokenIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(PushToken)
        .where(PushToken.token == body.token)
        .order_by(PushToken.created_at, PushToken.id)
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    rows = list((await db.execute(query)).scalars().all())

    if rows:
        keep = rows[0]
        keep.user_id = user.id
        for duplicate in rows[1:]:
            await db.delete(duplicate)
    else:
        db.add(PushToken(user_id=user.id, token=body.token))

    await db.commit()
    return {"ok": True}


@router.post("/unregister")
@router.delete("/token")
async def unregister_token(
    body: TokenIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Detach this user's push token(s) from the account (COM-017, idempotent).

    Called on logout so the next account on the same device does not receive
    the previous user's notifications. Only the caller's own rows are touched:
    a token currently bound to someone else is left alone. Without a body every
    token of the caller is removed (sign out everywhere).
    """
    stmt = delete(PushToken).where(PushToken.user_id == user.id)
    if body is not None:
        stmt = stmt.where(PushToken.token == body.token)
    result = await db.execute(stmt)
    await db.commit()
    return {"ok": True, "removed": int(result.rowcount or 0)}
