"""End-to-end integrity for resumable project checkout."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import Payment, PaymentStatus
from app.services import payment_checkout_service as checkout_svc
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "checkout_resume.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.environment = "development"
    cfg.settings.yookassa_shop_id = None
    cfg.settings.yookassa_secret = None
    cfg.settings.public_base_url = "http://127.0.0.1:8081"

    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _customer_project_and_payment(client: AsyncClient):
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    headers = {"X-User-Id": customer["id"]}
    project_id = (await client.get("/api/v1/projects", headers=headers)).json()[0]["id"]
    payments = (await client.get(f"/api/v1/projects/{project_id}/payments", headers=headers)).json()
    pending = next(payment for payment in payments if payment["status"] == "pending")
    return customer, headers, project_id, pending["id"]


async def test_lost_checkout_response_reloads_same_provider_payment(monkeypatch):
    calls: list[str | None] = []

    async def fake_create_or_resume_checkout(**kwargs):
        calls.append(kwargs["existing_provider_id"])
        return {
            "demo": False,
            "payment_id": "yk-resume-1",
            "confirmation_url": "https://pay.example/yk-resume-1",
            "status": "pending",
        }

    monkeypatch.setattr(
        checkout_svc,
        "create_or_resume_checkout",
        fake_create_or_resume_checkout,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, headers, project_id, payment_id = await _customer_project_and_payment(client)
        path = f"/api/v1/projects/{project_id}/payments/{payment_id}/yookassa-checkout"

        first = await client.post(path, headers=headers)
        second = await client.post(path, headers=headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["yookassa_payment_id"] == "yk-resume-1"
    assert second.json()["yookassa_payment_id"] == "yk-resume-1"
    assert second.json()["message"] == "Платёж восстановлен"
    assert calls == [None, "yk-resume-1"]

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        payment = await db.get(Payment, payment_id)
        assert payment is not None
        assert payment.status == PaymentStatus.processing
        assert payment.yookassa_payment_id == "yk-resume-1"
        assert payment.payment_method == "yookassa"


async def test_resume_rejects_provider_identity_change(monkeypatch):
    calls = 0

    async def fake_create_or_resume_checkout(**kwargs):
        nonlocal calls
        calls += 1
        provider_id = "yk-original" if calls == 1 else "yk-other"
        return {
            "demo": False,
            "payment_id": provider_id,
            "confirmation_url": f"https://pay.example/{provider_id}",
            "status": "pending",
        }

    monkeypatch.setattr(
        checkout_svc,
        "create_or_resume_checkout",
        fake_create_or_resume_checkout,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, headers, project_id, payment_id = await _customer_project_and_payment(client)
        path = f"/api/v1/projects/{project_id}/payments/{payment_id}/yookassa-checkout"
        first = await client.post(path, headers=headers)
        mismatch = await client.post(path, headers=headers)

    assert first.status_code == 200, first.text
    assert mismatch.status_code == 409, mismatch.text
    assert mismatch.json()["detail"]["code"] == "yookassa_payment_id_mismatch"

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        payment = await db.get(Payment, payment_id)
        assert payment is not None
        assert payment.yookassa_payment_id == "yk-original"
        assert payment.status == PaymentStatus.processing


async def test_demo_success_is_committed_and_replayable():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        _, headers, project_id, payment_id = await _customer_project_and_payment(client)
        path = f"/api/v1/projects/{project_id}/payments/{payment_id}/yookassa-checkout"
        first = await client.post(path, headers=headers)
        replay = await client.post(path, headers=headers)

    assert first.status_code == 200, first.text
    assert first.json()["demo"] is True
    assert first.json()["status"] == "succeeded"
    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "succeeded"
    assert replay.json()["yookassa_payment_id"] == first.json()["yookassa_payment_id"]

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        payment = await db.get(Payment, payment_id)
        assert payment is not None
        assert payment.status == PaymentStatus.confirmed
        assert payment.payment_method == "yookassa"
        assert payment.yookassa_payment_id == first.json()["yookassa_payment_id"]
