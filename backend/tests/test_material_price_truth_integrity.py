from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
    MaterialPick,
    MaterialPickStatus,
    Project,
    Room,
    User,
    UserRole,
)
from app.services import material_price_service
from app.services import price_parser
from app.services.price_parser import PriceFetchError, PriceFetchResult


async def seed_price_pick(
    db,
    suffix: str,
    *,
    price: float = 2500,
    shop_url: str | None = "https://supplier.example/product/1",
    shop_name: str | None = "Supplier",
):
    customer = User(
        id=f"price-customer-{suffix}",
        phone=f"+7701{len(suffix):07d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"price-contractor-{suffix}",
        phone=f"+7702{len(suffix):07d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"price-project-{suffix}",
        name="Material price truth",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    room = Room(
        id=f"price-room-{suffix}",
        project_id=project.id,
        name="Кухня",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=2,
    )
    pick = MaterialPick(
        id=f"price-pick-{suffix}",
        project_id=project.id,
        room_id=room.id,
        name="Керамогранит",
        qty=4,
        unit="м²",
        price=price,
        shop_url=shop_url,
        shop_name=shop_name,
        status=MaterialPickStatus.draft,
    )
    db.add_all([customer, contractor, project, room, pick])
    await db.commit()
    return customer, contractor, project, room, pick


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("http://127.0.0.1/admin", "price_url_private_target"),
        ("http://169.254.169.254/latest/meta-data", "price_url_private_target"),
        ("http://[::1]/", "price_url_private_target"),
        ("http://localhost/", "price_url_private_target"),
        ("ftp://example.com/item", "price_url_scheme_forbidden"),
        ("https://user:pass@example.com/item", "price_url_credentials_forbidden"),
        ("https://example.com:8443/item", "price_url_port_forbidden"),
    ],
)
async def test_price_url_validation_blocks_internal_and_unsafe_targets(url, code):
    with pytest.raises(PriceFetchError) as captured:
        await price_parser.validate_public_url(url)
    assert captured.value.code == code


@pytest.mark.asyncio
async def test_price_url_validation_rejects_mixed_public_private_dns(monkeypatch):
    async def mixed_dns(_hostname: str, _port: int):
        return ("93.184.216.34", "10.20.30.40")

    monkeypatch.setattr(price_parser, "_resolve_addresses", mixed_dns)
    with pytest.raises(PriceFetchError) as captured:
        await price_parser.validate_public_url("https://supplier.example/item")
    assert captured.value.code == "price_url_private_target"


class _FakeResponse:
    def __init__(self, status_code: int, headers: dict[str, str], body: bytes = b""):
        self.status_code = status_code
        self.headers = headers
        self._body = body
        self.extensions: dict = {}
        self.encoding = "utf-8"

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def aiter_bytes(self):
        if self._body:
            yield self._body


class _FakeClient:
    responses: list[_FakeResponse] = []
    requested: list[str] = []

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, _method: str, url: str, **_kwargs):
        self.requested.append(url)
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_redirect_target_is_revalidated_before_second_request(monkeypatch):
    async def public_dns(_hostname: str, _port: int):
        return ("93.184.216.34",)

    _FakeClient.responses = [
        _FakeResponse(302, {"location": "http://127.0.0.1/internal"}),
    ]
    _FakeClient.requested = []
    monkeypatch.setattr(price_parser, "_resolve_addresses", public_dns)
    monkeypatch.setattr(price_parser.httpx, "AsyncClient", _FakeClient)

    with pytest.raises(PriceFetchError) as captured:
        await price_parser.fetch_price("https://supplier.example/item", 2500)
    assert captured.value.code == "price_url_private_target"
    assert _FakeClient.requested == ["https://supplier.example/item"]


@pytest.mark.asyncio
async def test_declared_oversized_response_is_rejected(monkeypatch):
    async def public_dns(_hostname: str, _port: int):
        return ("93.184.216.34",)

    _FakeClient.responses = [
        _FakeResponse(
            200,
            {
                "content-type": "text/html",
                "content-length": str(price_parser.MAX_RESPONSE_BYTES + 1),
            },
        ),
    ]
    _FakeClient.requested = []
    monkeypatch.setattr(price_parser, "_resolve_addresses", public_dns)
    monkeypatch.setattr(price_parser.httpx, "AsyncClient", _FakeClient)

    with pytest.raises(PriceFetchError) as captured:
        await price_parser.fetch_price("https://supplier.example/item", 2500)
    assert captured.value.code == "price_response_too_large"


def test_price_extraction_prefers_structured_product_evidence():
    html = """
    <html><head>
      <script type="application/ld+json">
        {"@type":"Product","offers":{"price":"12 990,50","priceCurrency":"RUB"}}
      </script>
      <meta itemprop="price" content="9999">
    </head><body>Старая цена 15 000 ₽</body></html>
    """
    assert price_parser.extract_price(html) == (12990.5, "live_jsonld")
    assert price_parser.extract_price('<meta property="product:price:amount" content="7 450">') == (
        7450.0,
        "live_meta",
    )
    assert price_parser.extract_price("Цена сегодня: 6 300 ₽") == (6300.0, "live_currency")
    assert price_parser.extract_price("Артикул 6300, доставка завтра") == (None, "unavailable")


@pytest.mark.asyncio
async def test_missing_url_never_invents_a_price(db):
    _, contractor, project, _, pick = await seed_price_pick(
        db,
        "no-url",
        price=0,
        shop_url=None,
        shop_name=None,
    )
    result = await material_price_service.sync_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
    )
    assert result is not None
    assert result.source == "no_url"
    assert result.price_changed is False
    assert result.pick.price == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_unavailable_supplier_keeps_existing_price_without_audit(db, monkeypatch):
    _, contractor, project, _, pick = await seed_price_pick(db, "unavailable")

    async def unavailable(_url: str, current: float):
        return PriceFetchResult(current, "generic", "unavailable", "https://supplier.example/item")

    monkeypatch.setattr(material_price_service, "fetch_price", unavailable)
    result = await material_price_service.sync_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
    )
    assert result is not None
    assert result.source == "unavailable"
    assert result.price_changed is False
    assert result.pick.price == 2500
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_live_price_change_commits_with_one_durable_activity(db, monkeypatch):
    _, contractor, project, _, pick = await seed_price_pick(db, "live")

    async def live(_url: str, _current: float):
        return PriceFetchResult(3190.0, "petrovich", "live_jsonld", "https://petrovich.ru/item")

    monkeypatch.setattr(material_price_service, "fetch_price", live)
    result = await material_price_service.sync_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
    )
    assert result is not None
    assert result.price_changed is True
    assert result.pick.price == 3190
    assert result.pick.shop_name == "Supplier"
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "material_pick",
            DomainOutbox.aggregate_id == pick.id,
        )
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(ActivityEvent)
        .where(
            ActivityEvent.project_id == project.id,
            ActivityEvent.kind == "MaterialPriceSynced",
        )
    ) == 1


@pytest.mark.asyncio
async def test_concurrent_price_edit_wins_and_external_result_is_rejected(db, monkeypatch):
    _, contractor, project, _, pick = await seed_price_pick(db, "stale")
    project_id = project.id
    pick_id = pick.id

    async def concurrent_edit(_url: str, _current: float):
        stored = await db.get(MaterialPick, pick_id)
        stored.price = 2700
        await db.commit()
        return PriceFetchResult(3190.0, "generic", "live_meta", "https://supplier.example/item")

    monkeypatch.setattr(material_price_service, "fetch_price", concurrent_edit)
    with pytest.raises(ValueError, match="material_pick_price_sync_stale"):
        await material_price_service.sync_material_price(
            db,
            project_id=project_id,
            pick_id=pick_id,
            actor_id=contractor.id,
        )

    assert await db.scalar(select(MaterialPick.price).where(MaterialPick.id == pick_id)) == 2700
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
