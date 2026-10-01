"""WebSocket чат — JWT required (?token=); inbox sub must match path user_id."""
from __future__ import annotations

import asyncio
from collections import defaultdict
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.request_auth import user_id_from_access_token
from app.db.session import SessionLocal
from app.models.entities import ChatThread, Project, User
from app.services import chat_participant_service as participant_svc
from app.services import team_service as team_svc

router = APIRouter()
rooms: dict[str, set[WebSocket]] = defaultdict(set)
inbox_rooms: dict[str, set[WebSocket]] = defaultdict(set)

# 4401 = unauthorized (custom close; browsers treat as abnormal)
_WS_UNAUTHORIZED = 4401
_WS_FORBIDDEN = 4403


async def _authenticate_ws(websocket: WebSocket) -> str | None:
    # Prefer short-lived ticket over long JWT in query (P2.20)
    ticket = websocket.query_params.get("ticket")
    if ticket:
        from app.services.ws_ticket_service import consume_ws_ticket

        uid = consume_ws_ticket(ticket)
        if uid:
            return uid
    token = websocket.query_params.get("token")
    if not token:
        # Also accept Authorization via first protocol header if clients send it
        auth = websocket.headers.get("authorization")
        if auth and auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
    if not token:
        return None
    return user_id_from_access_token(token)


async def _thread_access(user_id: str, thread_id: str) -> str | None:
    """Return ``"write"``, ``"read"`` or ``None`` (no access) for this thread now.

    ``write`` = may push frames into the room: active invited participant or a
    project member who is not read-only. Read-only guests and team viewers
    (``project_access_mode`` read_only) only listen (COM-013).
    """
    async with SessionLocal() as db:
        thread = await db.get(ChatThread, thread_id)
        if not thread:
            return None
        if await participant_svc.is_active_thread_participant(
            db,
            thread_id=thread_id,
            user_id=user_id,
        ):
            return "write"
        user = await db.get(User, user_id)
        project = await db.get(Project, thread.project_id) if thread.project_id else None
        if not user or not project or getattr(project, "trashed_at", None):
            return None
        mode, read_only = await team_svc.project_access_mode(db, user, project)
        if mode in ("none", "participant"):
            return None
        return "read" if read_only else "write"


async def _can_access_thread(user_id: str, thread_id: str) -> bool:
    return await _thread_access(user_id, thread_id) is not None


# COM-013: the only client->server frame is a throttled ``typing`` hint.
WS_MAX_FRAME_BYTES = 512
WS_TYPING_MIN_INTERVAL = 1.0
WS_MAX_VIOLATIONS = 20
# COM-042: ACL is re-validated while the socket is open (and on revoke events).
WS_ACCESS_RECHECK_SECONDS = 30.0
_WS_MESSAGE_TOO_BIG = 1009
_WS_POLICY = 1008

# websocket -> authenticated user id (for revoke-by-user and diagnostics)
socket_users: dict[WebSocket, str] = {}


async def recheck_user_access(thread_id: str, user_id: str) -> None:
    """Close this user's sockets in the room if they lost access (revoke event)."""
    sockets = [w for w in list(rooms.get(thread_id, ())) if socket_users.get(w) == user_id]
    if not sockets:
        return
    if await _thread_access(user_id, thread_id) is not None:
        return
    for sock in sockets:
        rooms[thread_id].discard(sock)
        try:
            await sock.close(code=_WS_FORBIDDEN)
        except Exception:
            pass


def _parse_client_frame(raw: str) -> dict | None:
    """Validate an incoming frame; ``None`` = drop. Only ``{"type": "typing"}``."""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or data.get("type") != "typing":
        return None
    return {"type": "typing"}


@router.websocket("/ws/chats/{thread_id}")
async def chat_ws(websocket: WebSocket, thread_id: str):
    uid = await _authenticate_ws(websocket)
    if not uid:
        await websocket.close(code=_WS_UNAUTHORIZED)
        return
    access = await _thread_access(uid, thread_id)
    if access is None:
        await websocket.close(code=_WS_FORBIDDEN)
        return
    await websocket.accept()
    rooms[thread_id].add(websocket)
    socket_users[websocket] = uid
    loop = asyncio.get_running_loop()
    last_check = loop.time()
    last_typing = 0.0
    violations = 0
    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=WS_ACCESS_RECHECK_SECONDS)
            except asyncio.TimeoutError:
                raw = None
            now = loop.time()
            if now - last_check >= WS_ACCESS_RECHECK_SECONDS:
                last_check = now
                access = await _thread_access(uid, thread_id)
                if access is None:
                    await websocket.close(code=_WS_FORBIDDEN)
                    return
            if raw is None:
                continue
            if len(raw.encode("utf-8", "ignore")) > WS_MAX_FRAME_BYTES:
                await websocket.close(code=_WS_MESSAGE_TOO_BIG)
                return
            frame = _parse_client_frame(raw)
            if frame is None or access != "write":
                violations += 1
                if violations > WS_MAX_VIOLATIONS:
                    await websocket.close(code=_WS_POLICY)
                    return
                continue
            if now - last_typing < WS_TYPING_MIN_INTERVAL:
                continue
            last_typing = now
            out = json.dumps({"type": "typing", "user_id": uid})
            for ws in list(rooms[thread_id]):
                if ws != websocket:
                    try:
                        await ws.send_text(out)
                    except Exception:
                        rooms[thread_id].discard(ws)
    except WebSocketDisconnect:
        pass
    finally:
        rooms[thread_id].discard(websocket)
        socket_users.pop(websocket, None)


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
