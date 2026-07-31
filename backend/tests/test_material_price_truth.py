import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.material_price_sync import sync_material_price
from app.api.v1.router import api_router
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import MaterialPick, Project, User, UserRole
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import price_parser


@pytest_asyncio.fixture
async def price_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_pick(
    db,
    *,
    price: float = 0,
    shop_url: str | None = "https://example.com/product/1",
):
    customer = User(
        id="customer-price",
        phone="+79990000801",
        role=UserRole.customer,
    )
    project = Project(
        id="project-price",
        name="Price truth",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    pick = MaterialPick(
        id="pick-price",
        project_id=project.id,
        name="Краска",
        qty=2,
        unit="шт",
        price=price,
        shop_url=shop_url,
    )
    db.add_all([customer, project, pick])
    await db.commit()
    return customer, project, pick


def test_router_exposes_only_canonical_price_sync_handler():
    path = "/api/v1/projects/{project_id}/material-picks/{pick_id}/sync-price"
    routes = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in set(getattr(route, "methods", set()) or set())
    ]
    assert len(routes) == 1
    assert routes[0].endpoint.__module__.endswith("material_price_sync")


def test_structured_price_extractor_ignores_arbitrary_page_numbers():
    html = """
    <div>Артикул 12345, рейтинг 4.8, осталось 7</div>
    <script type="application/ld+json">
      {"@type":"Product","offers":{"price":"2499.90","priceCurrency":"RUB"}}
    </script>
    """
    assert price_parser._extract_structured_prices(html) == [2499.90]
    assert price_parser._extract_structured_prices("Артикул 12345, рейтинг 4.8") == []


@pytest.mark.asyncio
async def test_private_and_local_price_urls_are_rejected_before_request():
    for url in (
        "http://127.0.0.1/admin",
        "http://10.0.0.2/product",
        "http://169.254.169.254/latest/meta-data",
        "http://localhost/product",
        "file:///etc/passwd",
    ):
        with pytest.raises(price_parser.PriceUnavailable) as error:
            await price_parser._validate_public_http_url(url)
        assert error.value.code in {"private_price_url", "invalid_price_url"}


class FakeResponse:
    def __init__(self, text: str, status_code: int = 200):
        self.text = text
        self.status_code = status_code


class FakeClient:
    def __init__(self, response: FakeResponse):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, *_args, **_kwargs):
        return self.response


@pytest.mark.asyncio
async def test_fetch_price_never_uses_current_or_midpoint_as_success(monkeypatch):
    monkeypatch.setattr(
        price_parser,
        "_validate_public_http_url",
        AsyncMock(return_value=None),
    )
    fake_httpx = SimpleNamespace(
        AsyncClient=lambda **_kwargs: FakeClient(FakeResponse("Артикул 12345"))
    )
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)

    with pytest.raises(price_parser.PriceUnavailable) as error:
        await price_parser.fetch_price("https://example.com/product", current=7777)
    assert error.value.code == "structured_price_not_found"


@pytest.mark.asyncio
async def test_sync_without_url_does_not_create_demo_price(price_db):
    customer, project, pick = await seed_pick(price_db, price=0, shop_url=None)

    with pytest.raises(HTTPException) as error:
        await sync_material_price(
            project.id,
            pick.id,
            user=customer,
            db=price_db,
        )

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "price_source_required"
    assert await price_db.scalar(
        select(MaterialPick.price).where(MaterialPick.id == pick.id)
    ) == 0


@pytest.mark.asyncio
async def test_sync_failure_preserves_existing_price(price_db, monkeypatch):
    customer, project, pick = await seed_pick(price_db, price=3200)
    monkeypatch.setattr(
        "app.api.v1.material_price_sync.fetch_price",
        AsyncMock(side_effect=price_parser.PriceUnavailable("price_request_failed")),
    )

    with pytest.raises(HTTPException) as error:
        await sync_material_price(
            project.id,
            pick.id,
            user=customer,
            db=price_db,
        )

    assert error.value.status_code == 424
    assert error.value.detail["code"] == "price_request_failed"
    assert error.value.detail["current_price"] == 3200
    assert await price_db.scalar(
        select(MaterialPick.price).where(MaterialPick.id == pick.id)
    ) == 3200


@pytest.mark.asyncio
async def test_verified_structured_price_updates_draft(price_db, monkeypatch):
    customer, project, pick = await seed_pick(price_db, price=3200)
    monkeypatch.setattr(
        "app.api.v1.material_price_sync.fetch_price",
        AsyncMock(return_value=(2890.5, "petrovich", "live_structured")),
    )

    response = await sync_material_price(
        project.id,
        pick.id,
        user=customer,
        db=price_db,
    )

    assert response["price"] == 2890.5
    assert response["shop_name"] == "petrovich"
    assert response["price_source"] == "live_structured"
    assert response["price_updated"] is True
    assert await price_db.scalar(
        select(MaterialPick.price).where(MaterialPick.id == pick.id)
    ) == 2890.5
