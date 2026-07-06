"""Expo Push API."""
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import PushToken

EXPO_URL = "https://exp.host/--/api/v2/push/send"

async def send_push(db: AsyncSession, user_id: str, title: str, body: str, data: dict | None = None) -> None:
    r = await db.execute(select(PushToken).where(PushToken.user_id == user_id))
    tokens = [t.token for t in r.scalars().all()]
    if not tokens:
        return
    msgs = [{"to": t, "title": title, "body": body, "data": {**(data or {}), "mutableContent": True, "_displayInForeground": True}} for t in tokens]
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(EXPO_URL, json=msgs, headers={"Accept": "application/json"})
    except Exception:
        pass
