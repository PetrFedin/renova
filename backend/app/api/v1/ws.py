"""WebSocket чат — broadcast треда + inbox пользователя."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from collections import defaultdict
import json

router = APIRouter()
rooms: dict[str, set[WebSocket]] = defaultdict(set)
inbox_rooms: dict[str, set[WebSocket]] = defaultdict(set)


@router.websocket("/ws/chats/{thread_id}")
async def chat_ws(websocket: WebSocket, thread_id: str):
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
    """Обновление списка чатов / badge — без polling."""
    await websocket.accept()
    inbox_rooms[user_id].add(websocket)
    try:
        while True:
            # ping / keepalive от клиента
            await websocket.receive_text()
    except WebSocketDisconnect:
        inbox_rooms[user_id].discard(websocket)


async def broadcast(thread_id: str, payload: dict) -> None:
    msg = json.dumps(payload)
    for ws in list(rooms.get(thread_id, [])):
        try:
            await ws.send_text(msg)
        except Exception:
            rooms[thread_id].discard(ws)


async def broadcast_inbox(user_id: str, payload: dict) -> None:
    if not user_id:
        return
    msg = json.dumps(payload)
    for ws in list(inbox_rooms.get(user_id, [])):
        try:
            await ws.send_text(msg)
        except Exception:
            inbox_rooms[user_id].discard(ws)
