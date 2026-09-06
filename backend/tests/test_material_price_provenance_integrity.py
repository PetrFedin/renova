from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.api.v1.router import api_router
from app.models import material_price_truth
from app.models.entities import (
    DomainOutbox,
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    Room,
    User,
    UserRole,
)
from app.services import material_price_service
from app.services.price_parser import PriceFetchResult
from app.services.purchase_create_service import prepare_purchase_from_picks


async def _seed(
    db,
    suffix: str,
    *,
    status: MaterialPickStatus = MaterialPickStatus.draft,
    price: float = 1000,
    source: str = "legacy_unknown",
    shop_url: str | None = None,
):
    customer = User(
        id=f"prov-customer-{suffix}",
        phone=f"+771{len(suffix):08d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"prov-contractor-{suffix}",
        phone=f"+772{len(suffix):08d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"prov-project-{suffix}",
        name="Material price provenance",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    room = Room(
        id=f"prov-room-{suffix}",
        project_id=project.id,
        name="Комната",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=0,
    )
    pick = MaterialPick(
        id=f"prov-pick-{suffix}",
        project_id=project.id,
        room_id=room.id,
        name="Материал",
        qty=2,
        unit="шт",
        price=price,
        price_source=source,
        shop_url=shop_url,
        status=status,
        supply_source="contractor_to_buy",
        qty_available=0,
    )
    db.add_all([customer, contractor, project, room, pick])
    await db.commit()
    return customer, contractor, project, pick


def test_runtime_has_one_canonical_material_price_sync_route():
    matches = [
        route
        for route in api_router.routes
        if getattr(route, "path", None)
        == "/api/v1/projects/{project_id}/material-picks/{pick_id}/sync-price"
        and "POST" in (getattr(route, "methods", set()) or set())
    ]
    assert len(matches) == 1
    assert matches[0].endpoint.__module__ == "app.api.v1.material_price_sync"


@pytest.mark.asyncio
async def test_same_approved_legacy_price_can_be_confirmed_without_reapproval(db):
    _, contractor, project, pick = await _seed(
        db,
        "same-approved",
        status=MaterialPickStatus.approved,
        price=1000,
        source="legacy_unknown",
    )

    updated = await material_price_service.set_manual_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
        price=1000,
    )

    assert updated is not None
    assert updated.price == 1000
    assert updated.price_source == "manual"
    assert updated.status == MaterialPickStatus.approved
    assert updated.price_verified_at is None
    assert updated.price_source_url is None
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 1


@pytest.mark.asyncio
async def test_changed_approved_manual_price_requires_reapproval(db):
    _, contractor, project, pick = await _seed(
        db,
        "changed-approved",
        status=MaterialPickStatus.approved,
        price=1000,
        source="legacy_unknown",
    )

    updated = await material_price_service.set_manual_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
        price=1200,
    )

    assert updated is not None
    assert updated.price == 1200
    assert updated.price_source == "manual"
    assert updated.status == MaterialPickStatus.pending


@pytest.mark.asyncio
async def test_live_verification_persists_source_time_and_final_url(db, monkeypatch):
    _, contractor, project, pick = await _seed(
        db,
        "live",
        status=MaterialPickStatus.approved,
        price=2500,
        source="manual",
        shop_url="https://supplier.example/item",
    )

    async def live(_url: str, _current: float):
        return PriceFetchResult(
            2500,
            "generic",
            "live_meta",
            "https://supplier.example/item?canonical=1",
        )

    monkeypatch.setattr(material_price_service, "fetch_price", live)
    result = await material_price_service.sync_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
    )

    assert result is not None
    assert result.price_changed is False
    assert result.requires_reapproval is False
    assert result.pick.status == MaterialPickStatus.approved
    assert result.pick.price_source == "live_meta"
    assert result.pick.price_verified_at is not None
    assert result.pick.price_source_url == "https://supplier.example/item?canonical=1"


@pytest.mark.asyncio
async def test_unavailable_refresh_keeps_last_verified_provenance(db, monkeypatch):
    _, contractor, project, pick = await _seed(
        db,
        "unavailable",
        price=2500,
        source="live_jsonld",
        shop_url="https://supplier.example/item",
    )
    pick.price_source_url = "https://supplier.example/original"
    from app.core.timeutil import utc_now

    pick.price_verified_at = utc_now()
    await db.commit()
    verified_at = pick.price_verified_at

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
    assert result.pick.price == 2500
    assert result.pick.price_source == "live_jsonld"
    assert result.pick.price_verified_at == verified_at
    assert result.pick.price_source_url == "https://supplier.example/original"


@pytest.mark.asyncio
async def test_legacy_unknown_price_is_blocked_then_manual_confirmation_unblocks_purchase(db):
    _, contractor, project, pick = await _seed(
        db,
        "purchase",
        status=MaterialPickStatus.approved,
        price=1000,
        source="legacy_unknown",
    )
    contractor_id = contractor.id
    project_id = project.id
    pick_id = pick.id

    with pytest.raises(ValueError, match="purchase_pick_price_unverified"):
        await prepare_purchase_from_picks(
            db,
            project_id=project_id,
            actor=contractor,
            pick_ids=[pick_id],
            supplier_name="Поставщик",
        )
    await db.rollback()
    assert await db.scalar(select(func.count()).select_from(Purchase)) == 0

    confirmed = await material_price_service.set_manual_material_price(
        db,
        project_id=project_id,
        pick_id=pick_id,
        actor_id=contractor_id,
        price=1000,
    )
    assert confirmed is not None
    assert confirmed.status == MaterialPickStatus.approved
    assert material_price_truth.is_actionable_purchase_price(confirmed) is True

    contractor = await db.get(User, contractor_id)
    assert contractor is not None
    purchase = await prepare_purchase_from_picks(
        db,
        project_id=project_id,
        actor=contractor,
        pick_ids=[pick_id],
        supplier_name="Поставщик",
    )
    assert purchase.total_amount == 2000
    assert purchase.items[0].unit_price == 1000
