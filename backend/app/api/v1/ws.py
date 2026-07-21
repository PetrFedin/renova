"""WebSocket чат — JWT required (?token=); inbox sub must match path user_id."""
from __future__ import annotations

from collections import defaultdict
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError
from sqlalchemy import select

from app.core.request_auth import user_id_from_access_token
from app.db.session import SessionLocal
from app.models.entities import ChatThread, ChatThreadParticipant, Project, User
from app.services import team_service as team_svc

router = APIRouter()
rooms: dict[str, set[WebSocket]] = defaultdict(set)
inbox_rooms: dict[str, set[WebSocket]] = defaultdict(set)

# 4401 = unauthorized (custom close; browsers treat as abnormal)
_WS_UNAUTHORIZED = 4401
_WS_FORBIDDEN = 4403


async def _authenticate_ws(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("token")
    if not token:
        # Also accept Authorization via first protocol header if clients send it
        auth = websocket.headers.get("authorization")
        if auth and auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
    try:
        return user_id_from_access_token(token)
    except JWTError:
        return None


async def _can_access_thread(user_id: str, thread_id: str) -> bool:
    async with SessionLocal() as db:
        thread = await db.get(ChatThread, thread_id)
        if not thread:
            return False
        part = (
            await db.execute(
                select(ChatThreadParticipant).where(
                    ChatThreadParticipant.thread_id == thread_id,
                    ChatThreadParticipant.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if part:
            return True
        user = await db.get(User, user_id)
        project = await db.get(Project, thread.project_id) if thread.project_id else None
        if not user or not project:
            return False
        mode, _ = await team_svc.project_access_mode(db, user, project)
        return mode != "none"


@router.websocket("/ws/chats/{thread_id}")
async def chat_ws(websocket: WebSocket, thread_id: str):
    uid = await _authenticate_ws(websocket)
    if not uid:
        await websocket.close(code=_WS_UNAUTHORIZED)
        return
    if not await _can_access_thread(uid, thread_id):
        await websocket.close(code=_WS_FORBIDDEN)
        return
    await websocket.accept()
    rooms[thread_id].add(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            for ws in list(rooms[thread_id]):
                if ws != websocket:
                    try:
                        await ws.send_text(data)
                    except Exception:
                        rooms[thread_id].discard(ws)
    except WebSocketDisconnect:
        rooms[thread_id].discard(websocket)


@router.websocket("/ws/inbox/{user_id}")
async def inbox_ws(websocket: WebSocket, user_id: str):
    """Обновление списка чатов / badge — без polling. JWT sub must == user_id."""
    uid = await _authenticate_ws(websocket)
    if not uid:
        await websocket.close(code=_WS_UNAUTHORIZED)
        return
    if uid != user_id:
        await websocket.close(code=_WS_FORBIDDEN)
        return
    await websocket.accept()
    inbox_rooms[user_id].add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        inbox_rooms[user_id].discard(websocket)



async def _redis_publish(channel: str, packed: str) -> None:
    """Best-effort cross-instance fanout when REDIS_URL set (packed = instance envelope)."""
    from app.core.config import settings
    url = (settings.redis_url or "").strip()
    if not url:
        return
    try:
        import redis.asyncio as redis  # type: ignore
        client = redis.from_url(url, decode_responses=True)
        try:
            await client.publish(channel, packed)
        finally:
            await client.aclose()
    except Exception:
        # Fail-open locally: in-process rooms still deliver on this instance
        pass


async def broadcast(thread_id: str, payload: dict) -> None:
    from app.services.ws_redis_bridge import pack_message, deliver_local_thread

    msg = json.dumps(payload)
    packed = pack_message(payload)
    await _redis_publish(f"renova:ws:thread:{thread_id}", packed)
    await deliver_local_thread(thread_id, msg)


async def broadcast_inbox(user_id: str, payload: dict) -> None:
    if not user_id:
        return
    from app.services.ws_redis_bridge import pack_message, deliver_local_inbox

    msg = json.dumps(payload)
    packed = pack_message(payload)
    await _redis_publish(f"renova:ws:inbox:{user_id}", packed)
    await deliver_local_inbox(user_id, msg)
