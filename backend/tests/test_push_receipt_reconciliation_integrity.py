from __future__ import annotations

import asyncio
import os
import uuid
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import PushToken, User, UserRole
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.models.outbox_runtime import ExpoPushReceipt
from app.services import push_receipt_service as receipts


class FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", receipts.EXPO_RECEIPTS_URL)
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("receipt request failed", request=request, response=response)

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeAsyncClient:
    def __init__(self, handler):
        self.handler = handler
        self.calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url, *, json, headers):
        self.calls.append({"url": url, "json": json, "headers": headers})
        result = self.handler(json, len(self.calls))
        if isinstance(result, Exception):
            raise result
        return result


def install_client(monkeypatch, handler) -> FakeAsyncClient:
    client = FakeAsyncClient(handler)
    monkeypatch.setattr(receipts.httpx, "AsyncClient", lambda **_kwargs: client)
    return client


@pytest_asyncio.fixture
async def receipt_store(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'push-receipts.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield engine, session_factory
    await engine.dispose()


async def seed_token(session_factory, suffix: str, *, token_value: str | None = None):
    token_value = token_value or f"ExpoPushToken[token_{suffix}]"
    async with session_factory() as db:
        user = User(
            id=f"user-{suffix}",
            phone=f"+7999{abs(hash(suffix)) % 10000000:07d}",
            role=UserRole.customer,
        )
        token = PushToken(
            id=f"token-{suffix}",
            user_id=user.id,
            token=token_value,
        )
        db.add_all([user, token])
        await db.commit()
    return token_value, f"token-{suffix}"


async def seed_receipt(
    session_factory,
    suffix: str,
    *,
    token_value: str | None = None,
    due: bool = True,
    expired: bool = False,
):
    token_value, token_id = await seed_token(
        session_factory,
        suffix,
        token_value=token_value,
    )
    now = utc_now()
    async with session_factory() as db:
        row = ExpoPushReceipt(
            id=f"receipt-row-{suffix}",
            expo_receipt_id=f"expo-receipt-{suffix}",
            push_token_id=token_id,
            token_fingerprint=receipts.token_fingerprint(token_value),
            delivery_id=f"rn_delivery_{suffix}",
            status="pending",
            attempts=0,
            next_attempt_at=now - timedelta(seconds=1) if due else now + timedelta(minutes=5),
            expires_at=now - timedelta(seconds=1) if expired else now + timedelta(hours=23),
            created_at=now - timedelta(minutes=16),
            updated_at=now,
        )
        db.add(row)
        await db.commit()
        return row.id, row.expo_receipt_id, token_id, token_value


@pytest.mark.asyncio
async def test_accepted_ticket_is_durable_without_raw_token(receipt_store, monkeypatch):
    _engine, session_factory = receipt_store
    token_value, token_id = await seed_token(session_factory, "persist")
    monkeypatch.setattr(receipts, "SessionLocal", session_factory)
    now = utc_now()

    created = await receipts.record_accepted_tickets_persistently(
        [
            receipts.AcceptedPushTicket(
                receipt_id="expo-ticket-persist",
                push_token_id=token_id,
                token=token_value,
                delivery_id="rn_delivery_persist",
            )
        ],
        now=now,
    )

    assert created == 1
    async with session_factory() as db:
        row = (
            await db.execute(
                select(ExpoPushReceipt).where(
                    ExpoPushReceipt.expo_receipt_id == "expo-ticket-persist"
                )
            )
        ).scalar_one()
    assert row.status == "pending"
    assert row.push_token_id == token_id
    assert row.delivery_id == "rn_delivery_persist"
    assert row.token_fingerprint == receipts.token_fingerprint(token_value)
    assert token_value not in row.token_fingerprint
    assert row.next_attempt_at == now + receipts.INITIAL_RECEIPT_DELAY
    assert row.expires_at == now + receipts.RECEIPT_RETENTION


@pytest.mark.asyncio
async def test_live_lease_blocks_second_worker_and_stale_claim_is_fenced(receipt_store):
    _engine, session_factory = receipt_store
    row_id, _receipt_id, _token_id, _token_value = await seed_receipt(
        session_factory, "fence"
    )
    started = utc_now()

    async with session_factory() as db:
        claim_a = (await receipts._claim_due(db, worker_id="worker-a", now=started))[0]
    async with session_factory() as db:
        assert await receipts._claim_due(
            db,
            worker_id="worker-b",
            now=started + timedelta(seconds=1),
        ) == []
    async with session_factory() as db:
        claim_b = (
            await receipts._claim_due(
                db,
                worker_id="worker-b",
                now=started + receipts.RECEIPT_LEASE_TTL + timedelta(seconds=1),
            )
        )[0]

    async with session_factory() as db:
        assert await receipts._finalize_ok(db, claim_a, now=utc_now()) is False
    async with session_factory() as db:
        assert await receipts._finalize_ok(db, claim_b, now=utc_now()) is True
        row = await db.get(ExpoPushReceipt, row_id)
    assert row.status == "reconciled"
    assert row.completed_at is not None


@pytest.mark.asyncio
async def test_missing_receipt_stays_pending_without_consuming_failure_attempt(receipt_store, monkeypatch):
    _engine, session_factory = receipt_store
    row_id, _receipt_id, _token_id, _token_value = await seed_receipt(
        session_factory, "missing"
    )
    client = install_client(monkeypatch, lambda _json, _call: FakeResponse({"data": {}}))

    async with session_factory() as db:
        metrics = await receipts.reconcile_pending(db, worker_id="missing-worker")
    assert metrics["missing"] == 1
    assert len(client.calls) == 1
    assert len(client.calls[0]["json"]["ids"]) == 1
    async with session_factory() as db:
        row = await db.get(ExpoPushReceipt, row_id)
    assert row.status == "pending"
    assert row.attempts == 0
    assert row.completed_at is None
    assert row.locked_by is None
    assert row.next_attempt_at > row.checked_at


@pytest.mark.asyncio
async def test_device_not_registered_finalizes_and_removes_only_matching_token(
    receipt_store,
    monkeypatch,
):
    _engine, session_factory = receipt_store
    row_id, receipt_id, token_id, _token_value = await seed_receipt(
        session_factory, "dnr"
    )
    install_client(
        monkeypatch,
        lambda _json, _call: FakeResponse(
            {
                "data": {
                    receipt_id: {
                        "status": "error",
                        "message": "device is no longer registered",
                        "details": {"error": "DeviceNotRegistered"},
                    }
                }
            }
        ),
    )

    async with session_factory() as db:
        metrics = await receipts.reconcile_pending(db, worker_id="dnr-worker")
    assert metrics["errors"] == 1
    async with session_factory() as db:
        row = await db.get(ExpoPushReceipt, row_id)
        token = await db.get(PushToken, token_id)
    assert row.status == "error"
    assert row.provider_error == "DeviceNotRegistered"
    assert row.completed_at is not None
    assert token is None


@pytest.mark.asyncio
async def test_delayed_dnr_cannot_delete_changed_token_value(receipt_store, monkeypatch):
    _engine, session_factory = receipt_store
    row_id, receipt_id, token_id, _token_value = await seed_receipt(
        session_factory, "rotated"
    )
    replacement = "ExpoPushToken[token_rotated_new]"
    async with session_factory() as db:
        token = await db.get(PushToken, token_id)
        token.token = replacement
        await db.commit()
    install_client(
        monkeypatch,
        lambda _json, _call: FakeResponse(
            {
                "data": {
                    receipt_id: {
                        "status": "error",
                        "message": "old token is dead",
                        "details": {"error": "DeviceNotRegistered"},
                    }
                }
            }
        ),
    )

    async with session_factory() as db:
        await receipts.reconcile_pending(db, worker_id="rotated-worker")
    async with session_factory() as db:
        row = await db.get(ExpoPushReceipt, row_id)
        token = await db.get(PushToken, token_id)
    assert row.status == "error"
    assert token is not None
    assert token.token == replacement


@pytest.mark.asyncio
async def test_transport_failure_backs_off_and_keeps_pending(receipt_store, monkeypatch):
    _engine, session_factory = receipt_store
    row_id, _receipt_id, _token_id, _token_value = await seed_receipt(
        session_factory, "transport"
    )
    request = httpx.Request("POST", receipts.EXPO_RECEIPTS_URL)
    install_client(
        monkeypatch,
        lambda _json, _call: httpx.ConnectError("offline", request=request),
    )

    async with session_factory() as db:
        metrics = await receipts.reconcile_pending(db, worker_id="transport-worker")
    assert metrics["retried"] == 1
    async with session_factory() as db:
        row = await db.get(ExpoPushReceipt, row_id)
    assert row.status == "pending"
    assert row.attempts == 1
    assert row.provider_error == "receipt_transport_error"
    assert row.next_attempt_at > row.checked_at
    assert row.locked_by is None


@pytest.mark.asyncio
async def test_expired_receipt_becomes_explicit_terminal_without_provider_call(
    receipt_store,
    monkeypatch,
):
    _engine, session_factory = receipt_store
    row_id, _receipt_id, _token_id, _token_value = await seed_receipt(
        session_factory, "expired", expired=True
    )
    client = install_client(monkeypatch, lambda _json, _call: FakeResponse({"data": {}}))

    async with session_factory() as db:
        metrics = await receipts.reconcile_pending(db, worker_id="expired-worker")
    assert metrics["expired"] == 1
    assert client.calls == []
    async with session_factory() as db:
        row = await db.get(ExpoPushReceipt, row_id)
    assert row.status == "expired"
    assert row.provider_error == "receipt_expired"
    assert row.completed_at is not None


def test_provider_batch_limit_is_hard_bounded():
    assert receipts._batch_limit(1) == 1
    assert receipts._batch_limit(1000) == 1000
    assert receipts._batch_limit(1001) == 1000
    assert receipts._batch_limit(100000) == 1000


@pytest.mark.asyncio
async def test_runtime_snapshot_is_operational_and_token_free(receipt_store):
    _engine, session_factory = receipt_store
    await seed_receipt(session_factory, "health")
    async with session_factory() as db:
        snapshot = await receipts.runtime_snapshot(db)
    assert snapshot["pending"] == 1
    assert snapshot["due"] == 1
    assert snapshot["max_batch_size"] == 1000
    assert "token" not in " ".join(snapshot.keys()).lower()


@pytest.mark.asyncio
async def test_postgres_replicas_cannot_claim_same_live_receipt():
    database_url = os.getenv("PUSH_RECEIPT_POSTGRES_URL")
    if not database_url:
        pytest.skip("PUSH_RECEIPT_POSTGRES_URL is only set by the dedicated PostgreSQL workflow")

    engine = create_async_engine(database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex[:10]
    now = utc_now()
    user_id = f"pg-user-{suffix}"
    token_id = f"pg-token-{suffix}"
    row_id = f"pg-receipt-{suffix}"
    token_value = f"ExpoPushToken[token_pg_{suffix}]"
    try:
        async with session_factory() as db:
            db.add_all(
                [
                    User(
                        id=user_id,
                        phone=f"+7988{int(suffix[:7], 16) % 10000000:07d}",
                        role=UserRole.customer,
                    ),
                    PushToken(id=token_id, user_id=user_id, token=token_value),
                    ExpoPushReceipt(
                        id=row_id,
                        expo_receipt_id=f"pg-expo-{suffix}",
                        push_token_id=token_id,
                        token_fingerprint=receipts.token_fingerprint(token_value),
                        delivery_id=f"rn_pg_{suffix}",
                        status="pending",
                        next_attempt_at=now - timedelta(seconds=1),
                        expires_at=now + timedelta(hours=1),
                        created_at=now - timedelta(minutes=20),
                        updated_at=now,
                    ),
                ]
            )
            await db.commit()

        async def claim(worker_id: str):
            async with session_factory() as db:
                return await receipts._claim_due(db, worker_id=worker_id, now=now)

        claims_a, claims_b = await asyncio.gather(claim("pg-a"), claim("pg-b"))
        all_claims = claims_a + claims_b
        assert len(all_claims) == 1
        assert all_claims[0].row_id == row_id
    finally:
        async with session_factory() as db:
            await db.execute(delete(ExpoPushReceipt).where(ExpoPushReceipt.id == row_id))
            await db.execute(delete(PushToken).where(PushToken.id == token_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
        await engine.dispose()
