"""Expo Push API."""
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import PushToken

EXPO_URL = "https://exp.host/--/api/v2/push/send"


async def send_push(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> bool:
    """Return whether push delivery was accepted or no device token exists."""
    result = await db.execute(select(PushToken).where(PushToken.user_id == user_id))
    tokens = [token.token for token in result.scalars().all()]
    if not tokens:
        return True
    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": {
                **(data or {}),
                "mutableContent": True,
                "_displayInForeground": True,
            },
        }
        for token in tokens
    ]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                EXPO_URL,
                json=messages,
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
        return True
    except Exception:
        return False
