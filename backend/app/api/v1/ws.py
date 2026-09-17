"""WebSocket чат — JWT required (?token=); inbox sub must match path user_id."""
from __future__ import annotations

from collections import defaultdict
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.request_auth import user_id_from_access_token
from app.services.ws_frame_contract import (
    FrameRateLimiter,
    InvalidClientFrame,
    parse_client_frame,
    server_typing_payload,
)
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
# 1008 is the standard policy-violation close.
_WS_POLICY_VIOLATION = 1008

# Authorisation is proved at connect. Re-prove it periodically so a revoked
# session or a removed participant stops receiving thread traffic without
# waiting for the socket to drop.
REAUTHORIZE_INTERVAL_SECONDS = 60.0


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


async def _can_access_thread(user_id: str, thread_id: str) -> bool:
    async with SessionLocal() as db:
        thread = await db.get(ChatThread, thread_id)
        if not thread:
            return False
        if await participant_svc.is_active_thread_participant(
            db,
            thread_id=thread_id,
            user_id=user_id,
        ):
            return True
        user = await db.get(User, user_id)
        project = await db.get(Project, thread.project_id) if thread.project_id else None
        if not user or not project or getattr(project, "trashed_at", None):
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

    limiter = FrameRateLimiter()
    reauthorized_at = time.monotonic()
    try:
        while True:
            raw = await websocket.receive_text()
            now = time.monotonic()

            # Authorisation was proved once, at connect. A long-lived socket
            # must not outlive a revoked session or a removed participant.
            if now - reauthorized_at >= REAUTHORIZE_INTERVAL_SECONDS:
                reauthorized_at = now
                if not await _can_access_thread(uid, thread_id):
                    await websocket.close(code=_WS_FORBIDDEN)
                    break

            if not limiter.allow(now):
                await websocket.close(code=_WS_POLICY_VIOLATION)
                break

            try:
                frame = parse_client_frame(raw)
            except InvalidClientFrame:
                # Never relay an unrecognised frame. The receive handler in the
                # mobile client treats any non-typing frame as a reason to
                # reload, so echoing arbitrary client bytes let one participant
                # both forge server events and flood another client.
                continue

            if not frame.broadcasts:
                continue

            # The server builds the outbound payload; client bytes never reach
            # another socket. This also supplies the authenticated sender id.
            outbound = json.dumps(
                server_typing_payload(user_id=uid), ensure_ascii=False
            )
            for ws in list(rooms[thread_id]):
                if ws != websocket:
                    try:
                        await ws.send_text(outbound)
                    except Exception:
                        rooms[thread_id].discard(ws)
    except WebSocketDisconnect:
        pass
    finally:
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

    limiter = FrameRateLimiter()
    try:
        while True:
            # Inbox frames are keepalives only; nothing is ever relayed from
            # here. The limiter still bounds a flood from one connection.
            await websocket.receive_text()
            if not limiter.allow(time.monotonic()):
                await websocket.close(code=_WS_POLICY_VIOLATION)
                break
    except WebSocketDisconnect:
        pass
    finally:
        inbox_rooms[user_id].discard(websocket)


async def _redis_publish(channel: str, packed: str) -> None:
    """Cross-instance fanout over the shared pooled client.

    This used to open and close a Redis connection per published frame, i.e. a
    TCP connect and RESP handshake per chat message and per inbox badge update.
    """
    from app.services.ws_publisher import publish

    await publish(channel, packed)


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
