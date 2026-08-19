from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError

from app.api.v1.push import TokenIn, register_token
from app.services import notification_service, push_service


class ScalarRows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class ScalarOneRow:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class FakeReadDb:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, _query):
        return ScalarRows(self.rows)


class FakeOutboxNotificationDb:
    def __init__(self, delivery, notification):
        self.delivery = delivery
        self.notification = notification
        self.commits = 0

    async def execute(self, _query):
        return ScalarOneRow(self.delivery)

    async def get(self, _model, entity_id):
        return self.notification if entity_id == self.delivery.entity_id else None

    async def commit(self):
        self.commits += 1


class FakeRegisterDb(FakeReadDb):
    def __init__(self, rows):
        super().__init__(rows)
        self.added = []
        self.deleted = []
        self.commits = 0

    def add(self, row):
        self.added.append(row)

    async def delete(self, row):
        self.deleted.append(row)

    async def commit(self):
        self.commits += 1


class FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", push_service.EXPO_URL)
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("push failed", request=request, response=response)

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeAsyncClient:
    def __init__(self, handler):
        self.handler = handler
        self.calls = []

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


def expo_token(index: int) -> str:
    return f"ExpoPushToken[token_{index:04d}]"


def token_row(index: int, token: str | None = None):
    return SimpleNamespace(
        id=f"row-{index:04d}",
        token=token or expo_token(index),
        created_at=index,
    )


def install_client(monkeypatch, handler):
    client = FakeAsyncClient(handler)
    monkeypatch.setattr(push_service.httpx, "AsyncClient", lambda **_kwargs: client)
    return client


@pytest.fixture(autouse=True)
def isolate_receipt_ledger(monkeypatch):
    persist = AsyncMock(return_value=1)
    monkeypatch.setattr(push_service, "record_accepted_tickets_persistently", persist)
    return persist


def test_stable_push_delivery_id_is_deterministic_bounded_and_opaque():
    source = "outbox:6e360415-cf44-4439-a5d1-e697e257ec96"

    first = push_service.stable_push_delivery_id(source)
    second = push_service.stable_push_delivery_id(source)

    assert first == second
    assert first.startswith("rn_")
    assert len(first) <= 64
    assert source not in first
    assert first != push_service.stable_push_delivery_id(f"{source}:other")
    with pytest.raises(ValueError, match="push_delivery_source_id_required"):
        push_service.stable_push_delivery_id("  ")


@pytest.mark.asyncio
async def test_no_device_token_is_successful_noop(monkeypatch):
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)

    assert await push_service.send_push(FakeReadDb([]), "user-1", "Title", "Body") is True
    cleanup.assert_not_awaited()


@pytest.mark.asyncio
async def test_delivery_identity_reaches_payload_provider_and_receipt_ledger(
    monkeypatch,
    isolate_receipt_ledger,
):
    client = install_client(
        monkeypatch,
        lambda messages, _call: FakeResponse(
            {"data": [{"status": "ok", "id": f"receipt-{message['to']}"} for message in messages]}
        ),
    )
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)
    delivery_id = push_service.stable_push_delivery_id("outbox:outbox-1")

    accepted = await push_service.send_push(
        FakeReadDb([token_row(1)]),
        "user-1",
        "Title",
        "Body",
        {"outbox_id": "outbox-1"},
        delivery_id=delivery_id,
    )

    assert accepted is True
    message = client.calls[0]["json"][0]
    assert message["collapseId"] == delivery_id
    assert message["tag"] == delivery_id
    assert message["mutableContent"] is True
    assert message["data"]["delivery_id"] == delivery_id
    assert message["data"]["outbox_id"] == "outbox-1"
    assert message["data"]["_displayInForeground"] is True
    assert "mutableContent" not in message["data"]
    persisted = isolate_receipt_ledger.await_args.args[0]
    assert len(persisted) == 1
    assert persisted[0].receipt_id == f"receipt-{expo_token(1)}"
    assert persisted[0].push_token_id == "row-0001"
    assert persisted[0].token == expo_token(1)
    assert persisted[0].delivery_id == delivery_id
    cleanup.assert_awaited_once_with(set())


@pytest.mark.asyncio
async def test_receipt_ledger_failure_fails_closed_for_outbox_retry(
    monkeypatch,
    isolate_receipt_ledger,
):
    install_client(
        monkeypatch,
        lambda messages, _call: FakeResponse(
            {"data": [{"status": "ok", "id": f"receipt-{message['to']}"} for message in messages]}
        ),
    )
    isolate_receipt_ledger.side_effect = RuntimeError("database unavailable")
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)

    accepted = await push_service.send_push(
        FakeReadDb([token_row(1)]),
        "user-1",
        "Title",
        "Body",
        delivery_id=push_service.stable_push_delivery_id("outbox:receipt-ledger-failure"),
    )

    assert accepted is False
    isolate_receipt_ledger.assert_awaited_once()


@pytest.mark.asyncio
async def test_outbox_retry_reuses_same_delivery_identity(monkeypatch):
    delivery = SimpleNamespace(entity_id="notification-1", delivered_at=None)
    notification = SimpleNamespace(id="notification-1")
    db = FakeOutboxNotificationDb(delivery, notification)
    outcomes = iter([False, True])
    attempts = []

    async def fake_send_push(
        _db,
        user_id,
        title,
        body,
        data=None,
        *,
        delivery_id=None,
    ):
        attempts.append(
            {
                "user_id": user_id,
                "title": title,
                "body": body,
                "data": dict(data or {}),
                "delivery_id": delivery_id,
            }
        )
        return next(outcomes)

    monkeypatch.setattr(notification_service, "send_push", fake_send_push)
    call = {
        "outbox_id": "outbox-retry-1",
        "user_id": "user-1",
        "project_id": "project-1",
        "notification_type": "other",
        "title": "Title",
        "body": "Body",
        "link_path": "/project/project-1",
        "return_to": "/",
    }

    with pytest.raises(RuntimeError, match="push_delivery_failed"):
        await notification_service.notify_from_outbox(db, **call)
    assert delivery.delivered_at is None
    assert db.commits == 0

    result = await notification_service.notify_from_outbox(db, **call)

    expected = push_service.stable_push_delivery_id("outbox:outbox-retry-1")
    assert result is notification
    assert [attempt["delivery_id"] for attempt in attempts] == [expected, expected]
    assert all(attempt["data"]["outbox_id"] == "outbox-retry-1" for attempt in attempts)
    assert delivery.delivered_at is not None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_duplicate_tokens_are_sent_once_and_batches_never_exceed_100(monkeypatch):
    rows = [token_row(index) for index in range(205)]
    rows.append(token_row(999, expo_token(0)))

    def handler(messages, _call_number):
        return FakeResponse(
            {
                "data": [
                    {"status": "ok", "id": f"receipt-{message['to']}"}
                    for message in messages
                ]
            }
        )

    client = install_client(monkeypatch, handler)
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)

    accepted = await push_service.send_push(
        FakeReadDb(rows),
        "user-1",
        "Title",
        "Body",
        {"outbox_id": "outbox-1"},
    )

    assert accepted is True
    assert [len(call["json"]) for call in client.calls] == [100, 100, 5]
    sent_tokens = [message["to"] for call in client.calls for message in call["json"]]
    assert len(sent_tokens) == len(set(sent_tokens)) == 205
    assert all(message["data"]["outbox_id"] == "outbox-1" for call in client.calls for message in call["json"])
    cleanup.assert_awaited_once_with(set())


@pytest.mark.asyncio
async def test_device_not_registered_and_malformed_stored_tokens_are_removed(monkeypatch):
    valid = expo_token(1)
    rows = [token_row(1, valid), token_row(2, "not-an-expo-token")]
    client = install_client(
        monkeypatch,
        lambda _messages, _call: FakeResponse(
            {
                "data": [
                    {
                        "status": "error",
                        "message": "not registered",
                        "details": {"error": "DeviceNotRegistered"},
                    }
                ]
            }
        ),
    )
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)

    accepted = await push_service.send_push(FakeReadDb(rows), "user-1", "Title", "Body")

    assert accepted is True
    assert len(client.calls) == 1
    cleanup.assert_awaited_once_with({valid, "not-an-expo-token"})


@pytest.mark.asyncio
async def test_http_200_ticket_error_is_not_false_success(monkeypatch):
    install_client(
        monkeypatch,
        lambda _messages, _call: FakeResponse(
            {
                "data": [
                    {
                        "status": "error",
                        "message": "credentials invalid",
                        "details": {"error": "InvalidCredentials"},
                    }
                ]
            }
        ),
    )
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)

    accepted = await push_service.send_push(
        FakeReadDb([token_row(1)]),
        "user-1",
        "Title",
        "Body",
    )

    assert accepted is False
    cleanup.assert_awaited_once_with(set())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"data": []},
        {"data": [{"status": "ok"}]},
        {"errors": [{"code": "TOO_MANY_REQUESTS", "message": "retry"}]},
        ["not", "an", "object"],
    ],
)
async def test_malformed_or_request_level_response_fails_closed(monkeypatch, payload):
    install_client(monkeypatch, lambda _messages, _call: FakeResponse(payload))
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)

    accepted = await push_service.send_push(
        FakeReadDb([token_row(1)]),
        "user-1",
        "Title",
        "Body",
    )

    assert accepted is False


@pytest.mark.asyncio
async def test_transport_failure_returns_false_for_outbox_retry(monkeypatch):
    request = httpx.Request("POST", push_service.EXPO_URL)
    install_client(monkeypatch, lambda _messages, _call: httpx.ConnectError("offline", request=request))
    cleanup = AsyncMock()
    monkeypatch.setattr(push_service, "_remove_tokens_persistently", cleanup)

    accepted = await push_service.send_push(
        FakeReadDb([token_row(1)]),
        "user-1",
        "Title",
        "Body",
    )

    assert accepted is False


def test_token_input_rejects_non_expo_values_and_normalizes_whitespace():
    with pytest.raises(ValidationError):
        TokenIn(token="device-token")

    parsed = TokenIn(token=f"  {expo_token(7)}  ")
    assert parsed.token == expo_token(7)


@pytest.mark.asyncio
async def test_registration_transfers_token_and_collapses_existing_duplicates():
    first = token_row(1, expo_token(9))
    first.user_id = "old-user"
    duplicate = token_row(2, expo_token(9))
    duplicate.user_id = "old-user"
    db = FakeRegisterDb([first, duplicate])

    result = await register_token(
        TokenIn(token=expo_token(9)),
        user=SimpleNamespace(id="new-user"),
        db=db,
    )

    assert result == {"ok": True}
    assert first.user_id == "new-user"
    assert db.deleted == [duplicate]
    assert db.added == []
    assert db.commits == 1


@pytest.mark.asyncio
async def test_registration_creates_one_canonical_row_when_token_is_new():
    db = FakeRegisterDb([])

    await register_token(
        TokenIn(token=expo_token(10)),
        user=SimpleNamespace(id="user-10"),
        db=db,
    )

    assert len(db.added) == 1
    assert db.added[0].user_id == "user-10"
    assert db.added[0].token == expo_token(10)
    assert db.commits == 1
