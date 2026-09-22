"""Возврат дизайна на доработку доносит причину до автора пакета."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.models.entities import DesignPackage, DomainOutbox, Project, User, UserRole
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "design_reject.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    from app.core import config

    config.settings.database_url = database_url
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()

    async with sess.SessionLocal() as db:
        customer = User(id="cust-dsg", phone="+70000008001", role=UserRole.customer)
        contractor = User(id="cont-dsg", phone="+70000008002", role=UserRole.contractor)
        project = Project(
            id="proj-dsg",
            name="Дизайн",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
            budget_planned=100000,
            budget_spent=0,
        )
        package = DesignPackage(
            id="dsg-1",
            project_id=project.id,
            title="Гостиная",
            version=1,
            status="pending",
        )
        db.add_all([customer, contractor, project, package])
        await db.commit()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _outbox_bodies() -> list[str]:
    async with sess.SessionLocal() as db:
        rows = (await db.execute(select(DomainOutbox))).scalars().all()
        # Полезная нагрузка лежит строкой JSON — берём её целиком, чтобы не
        # зависеть от формы конкретного события.
        return [row.payload_json or "" for row in rows]


async def test_reject_carries_the_reason_to_the_author():
    """Причина — весь смысл возврата: без неё автор не знает, что переделывать."""
    async with _client() as client:
        resp = await client.post(
            "/api/v1/projects/proj-dsg/design-packages/dsg-1/reject",
            headers={"X-User-Id": "cust-dsg"},
            json={"reason": "Поменять материалы в санузле"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "rejected"

    bodies = await _outbox_bodies()
    assert any("Поменять материалы в санузле" in body for body in bodies), bodies


async def test_reject_without_reason_still_works():
    """Причина необязательна — возврат не должен упираться в форму."""
    async with _client() as client:
        resp = await client.post(
            "/api/v1/projects/proj-dsg/design-packages/dsg-1/reject",
            headers={"X-User-Id": "cust-dsg"},
            json={},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "rejected"


async def test_reject_without_body_still_works():
    """Старые клиенты шлют пустой POST — он обязан работать как раньше."""
    async with _client() as client:
        resp = await client.post(
            "/api/v1/projects/proj-dsg/design-packages/dsg-1/reject",
            headers={"X-User-Id": "cust-dsg"},
        )
        assert resp.status_code == 200, resp.text


async def test_approve_is_unaffected():
    async with _client() as client:
        resp = await client.post(
            "/api/v1/projects/proj-dsg/design-packages/dsg-1/approve",
            headers={"X-User-Id": "cust-dsg"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "approved"
