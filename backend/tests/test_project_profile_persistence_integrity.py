"""Project profile persistence must survive API reloads and reject invalid patches."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.db import session as sess
from app.main import app
from app.models.entities import Project
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "project_profile_persistence.db"
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
        await ensure_demo_users(db)
        await seed_articles(db)


async def _owner_headers_and_project(client: AsyncClient) -> tuple[dict[str, str], str]:
    auth = await client.post("/api/v1/auth/demo", json={"role": "customer"})
    assert auth.status_code == 200
    headers = {"X-User-Id": auth.json()["id"]}
    listed = await client.get("/api/v1/projects", headers=headers)
    assert listed.status_code == 200
    assert listed.json(), "demo customer must have a project fixture"
    return headers, listed.json()[0]["id"]


async def test_customer_budget_uses_existing_project_column_mapping():
    assert "customer_budget" in Project.__table__.c
    assert "customer_budget" in Project.__mapper__.attrs
    column = Project.__table__.c.customer_budget
    assert column.name == "customer_budget"
    assert column.nullable is True


async def test_profile_patch_round_trips_budget_vat_name_and_address():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers, project_id = await _owner_headers_and_project(client)

        updated = await client.patch(
            f"/api/v1/projects/{project_id}",
            headers=headers,
            json={
                "name": "Профиль с бюджетом",
                "address": "Москва, Тестовая 1",
                "customer_budget": 1_250_000,
                "vat_rate": 10,
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["name"] == "Профиль с бюджетом"
        assert updated.json()["address"] == "Москва, Тестовая 1"
        assert updated.json()["customer_budget"] == 1_250_000
        assert updated.json()["vat_rate"] == 10

        # GET is a new request/session: prove the values were committed, not only
        # mutated in an in-memory response object.
        reloaded = await client.get(f"/api/v1/projects/{project_id}", headers=headers)
        assert reloaded.status_code == 200, reloaded.text
        assert reloaded.json()["name"] == "Профиль с бюджетом"
        assert reloaded.json()["address"] == "Москва, Тестовая 1"
        assert reloaded.json()["customer_budget"] == 1_250_000
        assert reloaded.json()["vat_rate"] == 10

        listed = await client.get("/api/v1/projects", headers=headers)
        assert listed.status_code == 200
        row = next(item for item in listed.json() if item["id"] == project_id)
        assert row["customer_budget"] == 1_250_000
        assert row["vat_rate"] == 10


async def test_optional_profile_fields_can_be_cleared_and_stay_cleared():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers, project_id = await _owner_headers_and_project(client)

        first = await client.patch(
            f"/api/v1/projects/{project_id}",
            headers=headers,
            json={"address": "Адрес до очистки", "customer_budget": 500_000},
        )
        assert first.status_code == 200, first.text
        assert first.json()["address"] == "Адрес до очистки"
        assert first.json()["customer_budget"] == 500_000

        cleared = await client.patch(
            f"/api/v1/projects/{project_id}",
            headers=headers,
            json={"address": None, "customer_budget": None},
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["address"] is None
        assert cleared.json()["customer_budget"] is None

        reloaded = await client.get(f"/api/v1/projects/{project_id}", headers=headers)
        assert reloaded.status_code == 200
        assert reloaded.json()["address"] is None
        assert reloaded.json()["customer_budget"] is None


@pytest.mark.parametrize(
    "patch",
    [
        {"customer_budget": -1},
        {"customer_budget": 0},
        {"vat_rate": 7},
        {"name": None},
        {"renovation_type": None},
        {"property_type": None},
    ],
)
async def test_invalid_profile_patch_is_422_not_silent_or_500(patch):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers, project_id = await _owner_headers_and_project(client)
        response = await client.patch(
            f"/api/v1/projects/{project_id}",
            headers=headers,
            json=patch,
        )
        assert response.status_code == 422, response.text
