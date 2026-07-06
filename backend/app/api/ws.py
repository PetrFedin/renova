from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from collections import defaultdict

router = APIRouter()
connections: dict[str, list[WebSocket]] = defaultdict(list)

@router.websocket("/ws/chats/{thread_id}")
async def chat_ws(websocket: WebSocket, thread_id: str):
    await websocket.accept()
    connections[thread_id].append(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            if raw.startswith("{"):
                import json
                try:
                    if json.loads(raw).get("type") == "typing":
                        for c in list(connections[thread_id]):
                            if c != websocket:
                                await c.send_text(raw)
                        continue
                except Exception:
                    pass
    except WebSocketDisconnect:
        connections[thread_id].remove(websocket)
