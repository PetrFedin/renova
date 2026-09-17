"""A chat socket must not relay client bytes.

`/ws/chats/{thread_id}` used to forward whatever a participant sent, verbatim,
to every other socket in the thread — no schema, no type check, no size limit,
no rate limit, no sender identity:

    data = await websocket.receive_text()
    for ws in list(rooms[thread_id]):
        if ws != websocket:
            await ws.send_text(data)

The mobile client sends exactly one thing, `{"type": "typing"}`
(ChatThreadView.tsx:493), and its receive handler calls `reload()` for every
frame that is not `typing` (ChatThreadView.tsx:296-304). So a thread
participant could both forge server-shaped events into another participant's
UI and hold that client in a reload loop.
"""
from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest

from app.api.v1 import ws as ws_module
from app.services.ws_frame_contract import (
    ALLOWED_CLIENT_EVENTS,
    MAX_CLIENT_FRAME_BYTES,
    MAX_CLIENT_FRAMES_PER_WINDOW,
    FrameRateLimiter,
    InvalidClientFrame,
    parse_client_frame,
    server_typing_payload,
)


# --- what a client may say ---------------------------------------------------


def test_typing_is_accepted():
    assert parse_client_frame(json.dumps({"type": "typing"})).event == "typing"


def test_typing_is_the_only_broadcasting_event():
    assert parse_client_frame(json.dumps({"type": "typing"})).broadcasts is True
    assert parse_client_frame("ping").broadcasts is False


def test_bare_ping_keepalive_is_accepted():
    """inboxSyncStore.ts and useInboxWebSocket.ts send a bare `ping`."""
    assert parse_client_frame("ping").event == "ping"


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "message", "message": {"text": "forged"}},
        {"type": "payment", "message": {"amount": 100000}},
        {"type": "confirm"},
        {"type": "system"},
        {"type": "reload"},
    ],
)
def test_server_shaped_events_are_rejected(payload: dict):
    """These are exactly the shapes that would forge a real chat event."""
    with pytest.raises(InvalidClientFrame):
        parse_client_frame(json.dumps(payload))


@pytest.mark.parametrize(
    "raw", ["", "   ", "not json", "[]", '"typing"', "null", json.dumps({"type": 1})]
)
def test_malformed_frames_are_rejected(raw: str):
    with pytest.raises(InvalidClientFrame):
        parse_client_frame(raw)


def test_oversized_frame_is_rejected():
    payload = json.dumps({"type": "typing", "pad": "x" * MAX_CLIENT_FRAME_BYTES})

    with pytest.raises(InvalidClientFrame, match="frame_too_large"):
        parse_client_frame(payload)


def test_allowlist_is_minimal():
    assert ALLOWED_CLIENT_EVENTS == frozenset({"typing", "ping"})


# --- what the server says back -----------------------------------------------


def test_outbound_payload_is_built_by_the_server_with_the_real_sender():
    payload = server_typing_payload(user_id="user-42")

    assert payload == {"type": "typing", "user_id": "user-42"}


def test_outbound_shape_stays_compatible_with_existing_clients():
    """ChatThreadView switches on payload.type === 'typing'."""
    assert server_typing_payload(user_id="u")["type"] == "typing"


def test_handler_never_relays_received_bytes():
    source = inspect.getsource(ws_module.chat_ws)

    assert "server_typing_payload(user_id=uid)" in source
    assert "send_text(raw)" not in source
    assert "send_text(data)" not in source


# --- flooding ----------------------------------------------------------------


def test_rate_limiter_allows_a_normal_typing_burst():
    limiter = FrameRateLimiter()

    assert all(limiter.allow(100.0 + i * 0.01) for i in range(MAX_CLIENT_FRAMES_PER_WINDOW))


def test_rate_limiter_stops_a_flood_inside_one_window():
    limiter = FrameRateLimiter()
    for i in range(MAX_CLIENT_FRAMES_PER_WINDOW):
        limiter.allow(100.0 + i * 0.001)

    assert limiter.allow(100.1) is False


def test_rate_limiter_window_rolls_over():
    limiter = FrameRateLimiter()
    for i in range(MAX_CLIENT_FRAMES_PER_WINDOW + 5):
        limiter.allow(100.0 + i * 0.001)

    assert limiter.allow(200.0) is True


def test_socket_handlers_install_a_limiter():
    for handler in (ws_module.chat_ws, ws_module.inbox_ws):
        assert "FrameRateLimiter()" in inspect.getsource(handler)


# --- long-lived authorisation ------------------------------------------------


def test_chat_socket_reauthorizes_periodically():
    source = inspect.getsource(ws_module.chat_ws)

    assert "REAUTHORIZE_INTERVAL_SECONDS" in source
    # Access is re-proved, not just re-timed.
    assert source.count("_can_access_thread(uid, thread_id)") >= 2


def test_reauthorization_interval_is_bounded():
    assert 0 < ws_module.REAUTHORIZE_INTERVAL_SECONDS <= 300


def test_sockets_are_always_removed_from_their_room():
    """A leaked socket keeps receiving thread traffic and leaks memory."""
    for handler in (ws_module.chat_ws, ws_module.inbox_ws):
        source = inspect.getsource(handler)
        assert "finally:" in source
        assert ".discard(websocket)" in source


# --- redis connection reuse --------------------------------------------------


def test_publish_path_uses_the_shared_pooled_client():
    source = inspect.getsource(ws_module._redis_publish)

    assert "from app.services.ws_publisher import publish" in source
    # The per-frame connect/handshake/teardown must be gone.
    assert "redis.from_url" not in source
    assert "aclose()" not in source


def test_publisher_module_creates_one_client_per_process():
    publisher_source = Path(
        inspect.getfile(__import__("app.services.ws_publisher", fromlist=["publish"]))
    ).read_text(encoding="utf-8")

    assert "_client = None" in publisher_source
    assert "async def close()" in publisher_source
    # Publishing is best-effort; a Redis outage must not fail a chat write.
    assert "return False" in publisher_source
