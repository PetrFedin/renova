"""The offline queue's X-Offline-Id must actually prevent duplicate mutations.

`apps/mobile/lib/offlineQueue.ts` has always sent a stable `X-Offline-Id` on
every replayed mutation and retries up to five times with a 15s timeout, while
`grep -rn "X-Offline-Id" backend/` returned nothing: the header was discarded.
A queued POST that committed and then lost its response created a duplicate on
the next attempt — a duplicate payment, expense, change order or acceptance.

These tests exercise the real ASGI stack, counting how many times the route
body actually executed.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import engine
from app.middleware.idempotency import ClientRequestIdempotencyMiddleware
from app.models.client_request_replay import (
    STATE_COMPLETED,
    STATE_IN_PROGRESS,
)
from app.services.client_request_replay_service import (
    MAX_REQUEST_KEY_LENGTH,
    is_valid_request_key,
    request_hash,
)

import app.models  # noqa: F401 — register every mapped table


@pytest.fixture(autouse=True)
async def _schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def _build_app() -> tuple[FastAPI, dict[str, int]]:
    """A minimal app whose route counts its own executions."""
    calls = {"count": 0}
    app = FastAPI()

    @app.post("/api/v1/probe/create")
    async def create():  # noqa: ANN202 — test route
        calls["count"] += 1
        return {"id": f"entity-{calls['count']}", "executions": calls["count"]}

    @app.post("/api/v1/probe/boom")
    async def boom():  # noqa: ANN202 — test route
        calls["count"] += 1
        raise RuntimeError("route exploded after no commit")

    @app.post("/api/v1/probe/unavailable")
    async def unavailable():  # noqa: ANN202 — test route
        from starlette.responses import JSONResponse

        calls["count"] += 1
        return JSONResponse({"detail": "upstream"}, status_code=503)

    app.add_middleware(ClientRequestIdempotencyMiddleware)
    return app, calls


def _auth_headers(user_id: str = "user-1") -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


async def _client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# --- the defect itself -------------------------------------------------------


async def test_replayed_request_executes_the_route_exactly_once():
    app, calls = _build_app()
    headers = {**_auth_headers(), "X-Offline-Id": "queued-job-1"}

    async with await _client(app) as client:
        first = await client.post("/api/v1/probe/create", json={"amount": 100}, headers=headers)
        second = await client.post("/api/v1/probe/create", json={"amount": 100}, headers=headers)

    assert calls["count"] == 1, "the route must not run twice for one queued job"
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json(), "the retry must observe the original answer"
    assert second.headers.get("x-idempotent-replay") == "true"
    assert first.headers.get("x-idempotent-replay") is None


async def test_five_retries_still_create_one_entity():
    """The queue's MAX_ATTEMPTS is 5; all five must collapse to one execution."""
    app, calls = _build_app()
    headers = {**_auth_headers(), "X-Offline-Id": "queued-job-retry-5"}

    async with await _client(app) as client:
        bodies = []
        for _ in range(5):
            response = await client.post(
                "/api/v1/probe/create", json={"amount": 250.5}, headers=headers
            )
            bodies.append(response.json())

    assert calls["count"] == 1
    assert all(body == bodies[0] for body in bodies)


# --- scope: anything without the header is untouched -------------------------


async def test_request_without_the_header_is_completely_unaffected():
    app, calls = _build_app()

    async with await _client(app) as client:
        first = await client.post("/api/v1/probe/create", json={"a": 1}, headers=_auth_headers())
        second = await client.post("/api/v1/probe/create", json={"a": 1}, headers=_auth_headers())

    assert calls["count"] == 2, "no header means the previous behaviour, unchanged"
    assert first.json() != second.json()


async def test_anonymous_request_is_not_claimed():
    """Auth decides the outcome; the middleware must not shadow a 401."""
    app, calls = _build_app()

    async with await _client(app) as client:
        await client.post(
            "/api/v1/probe/create", json={"a": 1}, headers={"X-Offline-Id": "no-auth"}
        )
        await client.post(
            "/api/v1/probe/create", json={"a": 1}, headers={"X-Offline-Id": "no-auth"}
        )

    assert calls["count"] == 2


async def test_get_requests_are_never_claimed():
    app = FastAPI()
    calls = {"count": 0}

    @app.get("/api/v1/probe/read")
    async def read():  # noqa: ANN202 — test route
        calls["count"] += 1
        return {"ok": True}

    app.add_middleware(ClientRequestIdempotencyMiddleware)
    headers = {**_auth_headers(), "X-Offline-Id": "read-key"}

    async with await _client(app) as client:
        await client.get("/api/v1/probe/read", headers=headers)
        await client.get("/api/v1/probe/read", headers=headers)

    assert calls["count"] == 2


# --- isolation ---------------------------------------------------------------


async def test_the_same_key_from_two_users_is_two_independent_claims():
    app, calls = _build_app()

    async with await _client(app) as client:
        await client.post(
            "/api/v1/probe/create",
            json={"a": 1},
            headers={**_auth_headers("user-a"), "X-Offline-Id": "shared-key"},
        )
        await client.post(
            "/api/v1/probe/create",
            json={"a": 1},
            headers={**_auth_headers("user-b"), "X-Offline-Id": "shared-key"},
        )

    assert calls["count"] == 2


async def test_reusing_a_key_with_a_different_payload_is_rejected():
    app, calls = _build_app()
    headers = {**_auth_headers(), "X-Offline-Id": "reused-key"}

    async with await _client(app) as client:
        await client.post("/api/v1/probe/create", json={"amount": 100}, headers=headers)
        conflict = await client.post(
            "/api/v1/probe/create", json={"amount": 999}, headers=headers
        )

    assert calls["count"] == 1
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_key_reused"


async def test_same_key_on_a_different_path_is_rejected_not_replayed():
    app, calls = _build_app()
    headers = {**_auth_headers(), "X-Offline-Id": "path-key"}

    async with await _client(app) as client:
        await client.post("/api/v1/probe/create", json={"a": 1}, headers=headers)
        conflict = await client.post("/api/v1/probe/unavailable", json={"a": 1}, headers=headers)

    assert conflict.status_code == 409
    assert calls["count"] == 1


# --- failure handling --------------------------------------------------------


async def test_a_raising_route_releases_the_claim_so_a_retry_can_proceed():
    app, calls = _build_app()
    headers = {**_auth_headers(), "X-Offline-Id": "boom-key"}

    async with await _client(app) as client:
        with pytest.raises(RuntimeError):
            await client.post("/api/v1/probe/boom", json={"a": 1}, headers=headers)
        with pytest.raises(RuntimeError):
            await client.post("/api/v1/probe/boom", json={"a": 1}, headers=headers)

    assert calls["count"] == 2, "a route that never committed must stay retryable"


async def test_a_5xx_response_releases_the_claim():
    app, calls = _build_app()
    headers = {**_auth_headers(), "X-Offline-Id": "unavailable-key"}

    async with await _client(app) as client:
        first = await client.post("/api/v1/probe/unavailable", json={"a": 1}, headers=headers)
        second = await client.post("/api/v1/probe/unavailable", json={"a": 1}, headers=headers)

    assert first.status_code == second.status_code == 503
    assert calls["count"] == 2


async def test_a_4xx_response_is_recorded_and_replayed():
    """A validation rejection is an authoritative answer, not a transient one."""
    app = FastAPI()
    calls = {"count": 0}

    @app.post("/api/v1/probe/reject")
    async def reject():  # noqa: ANN202 — test route
        from starlette.responses import JSONResponse

        calls["count"] += 1
        return JSONResponse({"detail": "invalid_category"}, status_code=422)

    app.add_middleware(ClientRequestIdempotencyMiddleware)
    headers = {**_auth_headers(), "X-Offline-Id": "reject-key"}

    async with await _client(app) as client:
        first = await client.post("/api/v1/probe/reject", json={"a": 1}, headers=headers)
        second = await client.post("/api/v1/probe/reject", json={"a": 1}, headers=headers)

    assert calls["count"] == 1
    assert first.status_code == second.status_code == 422
    assert second.headers.get("x-idempotent-replay") == "true"


async def test_concurrent_duplicates_execute_the_route_once():
    app, calls = _build_app()
    headers = {**_auth_headers(), "X-Offline-Id": "concurrent-key"}

    async with await _client(app) as client:
        responses = await asyncio.gather(
            *(
                client.post("/api/v1/probe/create", json={"a": 1}, headers=headers)
                for _ in range(4)
            )
        )

    assert calls["count"] == 1
    # The losers either replay the answer or fail closed — never a duplicate.
    for response in responses:
        assert response.status_code in (200, 409)


# --- ledger state ------------------------------------------------------------


async def test_ledger_records_a_completed_claim():
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.models.client_request_replay import ClientRequestReplay

    app, _calls = _build_app()
    headers = {**_auth_headers("ledger-user"), "X-Offline-Id": "ledger-key"}

    async with await _client(app) as client:
        await client.post("/api/v1/probe/create", json={"a": 1}, headers=headers)

    async with SessionLocal() as db:
        row = (
            await db.execute(
                select(ClientRequestReplay).where(
                    ClientRequestReplay.request_key == "ledger-key"
                )
            )
        ).scalar_one()

    assert row.state == STATE_COMPLETED
    assert row.state != STATE_IN_PROGRESS
    assert row.status_code == 200
    assert row.response_retained is True
    assert row.method == "POST"
    assert row.path == "/api/v1/probe/create"


# --- key validation ----------------------------------------------------------


@pytest.mark.parametrize("value", ["job-1", "a" * MAX_REQUEST_KEY_LENGTH, "UUID-4-abc"])
def test_valid_request_keys(value: str):
    assert is_valid_request_key(value) is True


@pytest.mark.parametrize(
    "value", [None, "", "   ", "a" * (MAX_REQUEST_KEY_LENGTH + 1), "has space", "tab\there"]
)
def test_invalid_request_keys(value):
    assert is_valid_request_key(value) is False


def test_request_hash_binds_method_path_and_body():
    base = request_hash(method="POST", path="/a", body=b'{"x":1}')

    assert base != request_hash(method="PUT", path="/a", body=b'{"x":1}')
    assert base != request_hash(method="POST", path="/b", body=b'{"x":1}')
    assert base != request_hash(method="POST", path="/a", body=b'{"x":2}')
    assert base == request_hash(method="post", path="/a", body=b'{"x":1}')
