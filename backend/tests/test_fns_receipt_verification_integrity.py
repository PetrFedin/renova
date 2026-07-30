from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Expense, Project, Receipt, User, UserRole
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import receipt_integrity_service
from app.services.fns import receipt_verify
from app.services.fns.receipt_truth_repair import repair_legacy_receipt_truth


VALID_PARSED = {
    "valid": True,
    "fn": "9282440300123456",
    "fd": "12345",
    "fp": "1234567890",
    "amount": 123.45,
    "receipt_time": "20260730T1200",
    "operation": "1",
}


@pytest.fixture(autouse=True)
def receipt_settings(monkeypatch):
    monkeypatch.setattr(receipt_verify.settings, "environment", "test")
    monkeypatch.setattr(receipt_verify.settings, "fns_receipt_login", None)
    monkeypatch.setattr(receipt_verify.settings, "fns_receipt_password", None)
    monkeypatch.setattr(
        receipt_verify.settings,
        "fns_receipt_api_url",
        "https://proverkacheka.nalog.ru:9999/v1/inns/*/kkts/*/fss/*",
    )


class FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self.payload = payload

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, url, *, auth):
        self.calls.append({"url": url, "auth": auth})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def configure_live(monkeypatch, response):
    monkeypatch.setattr(receipt_verify.settings, "fns_receipt_login", "user@example.com")
    monkeypatch.setattr(receipt_verify.settings, "fns_receipt_password", "provider-password")
    client = FakeClient(response)
    monkeypatch.setattr(
        receipt_verify.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )
    return client


def test_qr_parser_rejects_missing_negative_and_invalid_date():
    assert receipt_verify.parse_receipt_qr(None)["valid"] is False
    assert receipt_verify.parse_receipt_qr("t=20260730T1200&s=-1&fn=1&i=2&fp=3")["reason"] == "amount"
    assert receipt_verify.parse_receipt_qr("t=bad&s=10&fn=1&i=2&fp=3")["reason"] == "date"


def test_qr_parser_normalizes_amount_and_required_fields():
    parsed = receipt_verify.parse_receipt_qr(
        "t=20260730T1200&s=123.456&fn=9282440300123456&i=12345&fp=1234567890&n=1"
    )
    assert parsed["valid"] is True
    assert parsed["amount"] == 123.46
    assert parsed["fd"] == "12345"
    assert parsed["operation"] == "1"


@pytest.mark.asyncio
async def test_missing_credentials_is_pending_not_demo_or_valid():
    result = await receipt_verify.verify_receipt(VALID_PARSED)

    assert result["status"] == "verification_pending"
    assert result["mode"] == "pending"
    assert result["verified"] is False
    assert result["accepted"] is False
    assert result["valid"] is False
    assert result["retryable"] is True
    assert "demo_code" not in result
    assert receipt_verify.fns_receipt_health()["demo_verify_allowed"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider_total",
    [123.45, 12345],
)
async def test_live_200_requires_json_evidence_and_accepts_rubles_or_kopecks(
    monkeypatch,
    provider_total,
):
    client = configure_live(
        monkeypatch,
        FakeResponse(
            200,
            {
                "document": {
                    "receipt": {
                        "total": provider_total,
                    }
                },
                "id": "provider-ticket-1",
            },
        ),
    )

    result = await receipt_verify.verify_receipt(VALID_PARSED)

    assert result["status"] == "verified_live"
    assert result["mode"] == "live"
    assert result["verified"] is True
    assert result["accepted"] is True
    assert result["valid"] is True
    assert len(client.calls) == 1
    assert client.calls[0]["auth"] == ("user@example.com", "provider-password")
    assert "tickets/12345" in client.calls[0]["url"]
    assert "fiscalSign=1234567890" in client.calls[0]["url"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (ValueError("invalid json"), "некорректный ответ"),
        ({}, "пустой ответ"),
        ({"status": "ok"}, "не содержит подтверждения"),
        ({"error": "provider rejected"}, "не содержит подтверждения"),
    ],
)
async def test_live_200_without_receipt_evidence_fails_closed(monkeypatch, payload, message):
    configure_live(monkeypatch, FakeResponse(200, payload))

    result = await receipt_verify.verify_receipt(VALID_PARSED)

    assert result["status"] == "verification_failed"
    assert result["verified"] is False
    assert result["valid"] is False
    assert message in result["message"]


@pytest.mark.asyncio
async def test_provider_amount_mismatch_is_invalid_not_pending(monkeypatch):
    configure_live(
        monkeypatch,
        FakeResponse(200, {"document": {"receipt": {"total": 99999}}, "id": "ticket"}),
    )

    result = await receipt_verify.verify_receipt(VALID_PARSED)

    assert result["status"] == "invalid"
    assert result["mode"] == "invalid"
    assert result["final"] is True
    assert result["retryable"] is False
    assert result["verified"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "expected_status", "expected_mode", "retryable"),
    [
        (400, "invalid", "invalid", False),
        (404, "invalid", "invalid", False),
        (401, "verification_failed", "failed", False),
        (403, "verification_failed", "failed", False),
        (429, "verification_pending", "pending", True),
        (500, "verification_pending", "pending", True),
        (503, "verification_pending", "pending", True),
    ],
)
async def test_http_statuses_map_to_truthful_states(
    monkeypatch,
    status_code,
    expected_status,
    expected_mode,
    retryable,
):
    configure_live(monkeypatch, FakeResponse(status_code, {"error": "failed"}))

    result = await receipt_verify.verify_receipt(VALID_PARSED)

    assert result["status"] == expected_status
    assert result["mode"] == expected_mode
    assert result["retryable"] is retryable
    assert result["verified"] is False
    assert result["accepted"] is False
    assert result["valid"] is False


@pytest.mark.asyncio
async def test_network_timeout_is_pending_and_never_verified(monkeypatch):
    request = httpx.Request("GET", "https://proverkacheka.nalog.ru")
    configure_live(monkeypatch, httpx.ReadTimeout("timeout", request=request))

    result = await receipt_verify.verify_receipt(VALID_PARSED)

    assert result["status"] == "verification_pending"
    assert result["retryable"] is True
    assert result["verified"] is False


def test_legacy_demo_verified_is_not_accepted_evidence():
    truth = receipt_verify.receipt_verification_truth("demo_verified", True)
    receipt = SimpleNamespace(fns_verified=True, verification_status="demo_verified")

    assert truth["legacy_demo"] is True
    assert truth["verified"] is False
    assert truth["accepted"] is False
    assert truth["valid"] is False
    assert receipt_verify.receipt_is_live_verified(receipt) is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mode", "verified", "expected"),
    [
        ("live", True, "verified_live"),
        ("live", False, "verification_failed"),
        ("pending", False, "verification_pending"),
        ("failed", False, "verification_failed"),
        ("invalid", False, "invalid"),
        ("offline", False, "saved_unverified"),
        ("demo", True, "saved_unverified"),
    ],
)
async def test_receipt_integrity_maps_exact_fns_states(mode, verified, expected):
    receipt = SimpleNamespace(fns_verified=False, verification_status="saved_unverified")
    db = SimpleNamespace(flush=AsyncMock())

    await receipt_integrity_service.apply_verification_result(
        db,
        receipt=receipt,
        verified=verified,
        mode=mode,
    )

    assert receipt.verification_status == expected
    assert receipt.fns_verified is (expected == "verified_live")
    db.flush.assert_awaited_once()


@pytest_asyncio.fixture
async def repair_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_legacy_demo_repair_downgrades_receipt_and_active_expense_idempotently(repair_db):
    user = User(id="fns-user", phone="+79991234567", role=UserRole.customer)
    project = Project(
        id="fns-project",
        name="FNS project",
        renovation_type="cosmetic",
        customer_id=user.id,
    )
    receipt = Receipt(
        id="fns-receipt",
        project_id=project.id,
        amount=123.45,
        qr_raw="t=20260730T1200&s=123.45&fn=1&i=2&fp=3",
        fns_verified=True,
        verification_status="demo_verified",
        expense_category="materials",
    )
    expense = Expense(
        id="fns-expense",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Legacy demo receipt",
        category="materials",
        amount=123.45,
        status="confirmed",
    )
    protected = Expense(
        id="fns-refund",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Refund evidence",
        category="materials",
        amount=123.45,
        status="refund",
    )
    repair_db.add_all([user, project, receipt, expense, protected])
    await repair_db.commit()

    first = await repair_legacy_receipt_truth(repair_db)
    await repair_db.commit()
    second = await repair_legacy_receipt_truth(repair_db)

    assert first == {"receipts_repaired": 1, "expenses_repaired": 1}
    assert second == {"receipts_repaired": 0, "expenses_repaired": 0}
    assert receipt.fns_verified is False
    assert receipt.verification_status == "saved_unverified"
    assert expense.status == "pending_receipt"
    assert protected.status == "refund"
