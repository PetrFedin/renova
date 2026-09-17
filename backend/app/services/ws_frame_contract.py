"""What a client is allowed to say on a WebSocket, and how often.

``/ws/chats/{thread_id}`` used to relay whatever a client sent, verbatim, to
every other socket in the thread:

    data = await websocket.receive_text()
    for ws in list(rooms[thread_id]):
        if ws != websocket:
            await ws.send_text(data)

No schema, no type check, no size limit, no rate limit, and no sender identity.
The only thing the mobile app actually sends is ``{"type": "typing"}``
(``ChatThreadView.tsx:493``), while its receive handler treats *every* frame
that is not ``typing`` as a reason to call ``reload()``
(``ChatThreadView.tsx:296-304``). Two consequences follow directly:

* a thread participant can forge any server event — including payment- and
  message-shaped ones — straight into another participant's UI;
* a participant can pin another participant's client in a reload loop by
  spamming frames.

The fix is to stop relaying client bytes at all. A client frame is parsed,
validated against a small allowlist, and then the *server* constructs the
outbound payload, adding the authenticated sender id that clients never had.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

# Frames a client may send on a chat socket.
CLIENT_EVENT_TYPING = "typing"
CLIENT_EVENT_PING = "ping"
ALLOWED_CLIENT_EVENTS: frozenset[str] = frozenset(
    {CLIENT_EVENT_TYPING, CLIENT_EVENT_PING}
)

# A typing notice is a few dozen bytes. Anything larger is not a client event.
MAX_CLIENT_FRAME_BYTES = 1024

# Per connection. A typing indicator fires on keystrokes, so the ceiling is
# generous for a human and still bounds a flood.
MAX_CLIENT_FRAMES_PER_WINDOW = 40
CLIENT_FRAME_WINDOW_SECONDS = 10.0


@dataclass(frozen=True, slots=True)
class ClientFrame:
    event: str

    @property
    def broadcasts(self) -> bool:
        """Whether this event produces a frame for the other participants."""
        return self.event == CLIENT_EVENT_TYPING


class InvalidClientFrame(ValueError):
    """The frame is not a recognised client event."""


def parse_client_frame(raw: str) -> ClientFrame:
    """Validate one inbound frame. Raises InvalidClientFrame."""
    if len(raw.encode("utf-8")) > MAX_CLIENT_FRAME_BYTES:
        raise InvalidClientFrame("frame_too_large")

    text = raw.strip()
    if not text:
        raise InvalidClientFrame("empty_frame")

    # The inbox socket sends a bare "ping" keepalive rather than JSON.
    if text == CLIENT_EVENT_PING:
        return ClientFrame(event=CLIENT_EVENT_PING)

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise InvalidClientFrame("not_json") from error

    if not isinstance(payload, dict):
        raise InvalidClientFrame("not_an_object")

    event = payload.get("type")
    if not isinstance(event, str) or event not in ALLOWED_CLIENT_EVENTS:
        raise InvalidClientFrame("unsupported_event")

    return ClientFrame(event=event)


def server_typing_payload(*, user_id: str) -> dict[str, str]:
    """The outbound frame, built by the server rather than echoed.

    Shape stays `{"type": "typing"}` so existing clients are unaffected; the
    authenticated sender is added so a client can tell who is typing and can
    ignore its own echo.
    """
    return {"type": CLIENT_EVENT_TYPING, "user_id": user_id}


class FrameRateLimiter:
    """Fixed window per connection, monotonic so a clock change cannot widen it."""

    __slots__ = ("_count", "_window_started", "_limit", "_window")

    def __init__(
        self,
        *,
        limit: int = MAX_CLIENT_FRAMES_PER_WINDOW,
        window_seconds: float = CLIENT_FRAME_WINDOW_SECONDS,
    ) -> None:
        self._count = 0
        self._window_started = 0.0
        self._limit = limit
        self._window = window_seconds

    def allow(self, now: float) -> bool:
        if now - self._window_started >= self._window:
            self._window_started = now
            self._count = 0
        self._count += 1
        return self._count <= self._limit
