"""Срок оплаты: создание со сроком, правка срока, очерёдность в выдаче."""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.services import payment_service as pay_svc

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "payment_due.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    from app.core import config

    # Движок и адрес базы — глобальные: без возврата назад следующий файл тестов
    # получит ссылку на уже удалённый временный файл и упадёт на «no such table».
    previous_engine = sess.engine
    previous_session = sess.SessionLocal
    previous_url = config.settings.database_url

    config.settings.database_url = database_url
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()

    async with sess.SessionLocal() as db:
        customer = User(id="cust-due", phone="+70000009001", role=UserRole.customer)
        contractor = User(id="cont-due", phone="+70000009002", role=UserRole.contractor)
        project = Project(
            id="proj-due",
            name="Срок оплаты",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
            budget_planned=100000,
            budget_spent=0,
        )
        stage = Stage(
            id="stage-due",
            project_id=project.id,
            name="Штукатурка",
            sort_order=1,
            status=StageStatus.done,
            payment_amount=5000,
            customer_accepted_at=datetime.utcnow(),
        )
        db.add_all([customer, contractor, project, stage])
        await db.commit()


    yield

    await sess.engine.dispose()
    sess.engine = previous_engine
    sess.SessionLocal = previous_session
    config.settings.database_url = previous_url


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _create(client: AsyncClient, *, title: str, due_at: str | None) -> dict:
    body = {
        "title": title,
        "amount": 5000,
        "payment_type": "stage",
        "stage_id": "stage-due",
    }
    if due_at is not None:
        body["due_at"] = due_at
    resp = await client.post(
        "/api/v1/projects/proj-due/payments",
        headers={"X-User-Id": "cont-due"},
        json=body,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_due_date_survives_create_and_list():
    """Срок, заданный при создании, возвращается и в ответе, и в списке счетов."""
    async with _client() as client:
        created = await _create(client, title="Этап 1", due_at="2026-10-05T12:00:00")
        assert created["due_at"] is not None
        assert created["due_at"].startswith("2026-10-05T12:00:00")

        listed = await client.get(
            "/api/v1/projects/proj-due/payments",
            headers={"X-User-Id": "cust-due"},
        )
        assert listed.status_code == 200
        rows = {row["id"]: row for row in listed.json()}
        assert rows[created["id"]]["due_at"].startswith("2026-10-05T12:00:00")


async def test_due_date_is_optional():
    """Счёт без срока остаётся валидным — поле необязательное."""
    async with _client() as client:
        created = await _create(client, title="Без срока", due_at=None)
        assert created["due_at"] is None


async def test_aware_due_date_is_stored_as_naive_utc():
    """Время с зоной приводится к наивному UTC, как и остальные времена в базе."""
    async with _client() as client:
        created = await _create(client, title="С зоной", due_at="2026-10-05T12:00:00+03:00")
        assert created["due_at"].startswith("2026-10-05T09:00:00")


async def test_due_date_can_be_set_and_cleared_after_creation():
    """Очерёдность меняется правкой срока у уже выставленного счёта."""
    async with _client() as client:
        created = await _create(client, title="Позже", due_at=None)
        patched = await client.patch(
            f"/api/v1/projects/proj-due/payments/{created['id']}/due-date",
            headers={"X-User-Id": "cust-due"},
            json={"due_at": "2026-10-01T00:00:00"},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["due_at"].startswith("2026-10-01T00:00:00")

        cleared = await client.patch(
            f"/api/v1/projects/proj-due/payments/{created['id']}/due-date",
            headers={"X-User-Id": "cust-due"},
            json={"due_at": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["due_at"] is None


async def test_due_date_cannot_be_changed_after_payment_leaves_pending():
    """Срок оплаты бессмыслен для уже оплаченного счёта — правка запрещена."""
    async with _client() as client:
        created = await _create(client, title="Оплачу", due_at=None)
        confirm = await client.post(
            f"/api/v1/projects/proj-due/payments/{created['id']}/confirm",
            headers={"X-User-Id": "cust-due"},
            json={"transfer_ack": True},
        )
        assert confirm.status_code == 200

        patched = await client.patch(
            f"/api/v1/projects/proj-due/payments/{created['id']}/due-date",
            headers={"X-User-Id": "cust-due"},
            json={"due_at": "2026-10-01T00:00:00"},
        )
        assert patched.status_code == 409
        assert patched.json()["detail"]["code"] == "payment_not_pending"


async def test_normalize_due_at_keeps_naive_and_converts_aware():
    assert pay_svc.normalize_due_at(None) is None
    naive = datetime(2026, 10, 5, 12, 0, 0)
    assert pay_svc.normalize_due_at(naive) == naive
    aware = datetime(2026, 10, 5, 12, 0, 0, tzinfo=timezone(timedelta(hours=3)))
    assert pay_svc.normalize_due_at(aware) == datetime(2026, 10, 5, 9, 0, 0)
