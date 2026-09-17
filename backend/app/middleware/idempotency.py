"""Generic replay protection for client-originated mutations.

``apps/mobile/lib/offlineQueue.ts`` already sends a stable ``X-Offline-Id`` on
every replayed mutation and retries up to five times with a 15s timeout. Before
this middleware nothing on the server read that header, so a queued POST that
committed and then lost its response created a duplicate on the next attempt.
Only 14 of 84 routers carry the transactional ``client_request_id`` mechanism.

Scope is deliberately narrow so the blast radius is zero for existing traffic:

* only unsafe methods (POST/PUT/PATCH/DELETE);
* only when a syntactically valid ``X-Offline-Id`` header is present;
* only for an authenticated subject.

A request without the header takes exactly the code path it took before — the
middleware does not buffer its body and does not touch the database.

Implemented as raw ASGI rather than ``BaseHTTPMiddleware`` because the request
body must be buffered and replayed to the application, which
``BaseHTTPMiddleware`` cannot do reliably.
"""
from __future__ import annotations

import json
import logging

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.request_auth import user_id_from_authorization
from app.services.client_request_replay_service import (
    ReplayConflict,
    ReplayInFlight,
    ReplayUnavailable,
    claim,
    complete,
    is_valid_request_key,
    release,
)

logger = logging.getLogger("renova.idempotency")

IDEMPOTENCY_HEADER = b"x-offline-id"
GUARDED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Below this the route provably did not produce an authoritative answer, so the
# claim is released and the client may retry.
_RELEASE_ON_STATUS_FROM = 500


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers") or ():
        if key.lower() == name:
            return value.decode("latin-1")
    return None


async def _send_json(send: Send, *, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("latin-1")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class ClientRequestIdempotencyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in GUARDED_METHODS:
            await self.app(scope, receive, send)
            return

        request_key = (_header(scope, IDEMPOTENCY_HEADER) or "").strip()
        if not is_valid_request_key(request_key):
            await self.app(scope, receive, send)
            return

        user_id = user_id_from_authorization(_header(scope, b"authorization"))
        if not user_id:
            # Anonymous traffic has no stable subject to scope a key to. Auth
            # decides the outcome, not this middleware.
            await self.app(scope, receive, send)
            return

        body = await self._buffer_body(receive)
        path = scope.get("path") or ""
        method = scope.get("method") or ""

        from app.db.session import SessionLocal

        try:
            async with SessionLocal() as db:
                owns_claim, replayed = await claim(
                    db,
                    user_id=user_id,
                    request_key=request_key,
                    method=method,
                    path=path,
                    body=body,
                )
        except ReplayConflict:
            await _send_json(
                send,
                status=409,
                payload={
                    "detail": {
                        "code": "idempotency_key_reused",
                        "message": "Тот же X-Offline-Id уже использован для другого запроса.",
                    }
                },
            )
            return
        except ReplayInFlight:
            await _send_json(
                send,
                status=409,
                payload={
                    "detail": {
                        "code": "idempotent_request_in_flight",
                        "message": "Запрос уже выполняется. Повторите позже.",
                    }
                },
            )
            return
        except ReplayUnavailable:
            await _send_json(
                send,
                status=409,
                payload={
                    "detail": {
                        "code": "idempotent_replay_unavailable",
                        "message": "Запрос уже выполнен, но ответ не сохранён.",
                    }
                },
            )
            return

        if not owns_claim and replayed is not None:
            await self._send_replay(send, replayed)
            return

        await self._execute_and_record(
            scope, send, body, user_id=user_id, request_key=request_key
        )

    async def _buffer_body(self, receive: Receive) -> bytes:
        chunks: list[bytes] = []
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        return b"".join(chunks)

    async def _send_replay(self, send: Send, row) -> None:
        payload = (row.response_body or "").encode("utf-8")
        media_type = (row.response_media_type or "application/json").encode("latin-1")
        await send(
            {
                "type": "http.response.start",
                "status": int(row.status_code or 200),
                "headers": [
                    (b"content-type", media_type),
                    (b"content-length", str(len(payload)).encode("latin-1")),
                    # Lets the client and any operator tell a replay from a
                    # fresh execution without diffing logs.
                    (b"x-idempotent-replay", b"true"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload})

    async def _execute_and_record(
        self,
        scope: Scope,
        send: Send,
        body: bytes,
        *,
        user_id: str,
        request_key: str,
    ) -> None:
        sent_body: list[bytes] = []
        status_code = 500
        media_type: str | None = None
        replayed_request = {"done": False}

        async def replay_receive() -> Message:
            if replayed_request["done"]:
                return {"type": "http.disconnect"}
            replayed_request["done"] = True
            return {"type": "http.request", "body": body, "more_body": False}

        async def capture_send(message: Message) -> None:
            nonlocal status_code, media_type
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                for key, value in message.get("headers") or ():
                    if key.lower() == b"content-type":
                        media_type = value.decode("latin-1")
            elif message["type"] == "http.response.body":
                sent_body.append(message.get("body", b""))
            await send(message)

        from app.db.session import SessionLocal

        try:
            await self.app(scope, replay_receive, capture_send)
        except Exception:
            # The route raised before producing an authoritative answer. The
            # session it owned is rolled back by its own context manager, so no
            # business state was committed and the claim must not block a retry.
            async with SessionLocal() as db:
                await release(db, user_id=user_id, request_key=request_key)
            raise

        if status_code >= _RELEASE_ON_STATUS_FROM:
            async with SessionLocal() as db:
                await release(db, user_id=user_id, request_key=request_key)
            return

        async with SessionLocal() as db:
            await complete(
                db,
                user_id=user_id,
                request_key=request_key,
                status_code=status_code,
                body=b"".join(sent_body),
                media_type=media_type,
            )
