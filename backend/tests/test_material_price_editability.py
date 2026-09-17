"""A material price may only be set where the lifecycle allows it.

`require_editable_pick` used to guard a `sync-price` route in
`app/api/v1/materials.py`. #311 deleted that route — it was synthetic and
fabricated `pick.price = 1000.0` — and moved price mutation to
`app/api/v1/material_price_sync.py`, where `_require_price_mutable_pick`
guards it instead.

The guard is stricter than the one it replaced, but nothing exercised its two
refusals. The only thing that asserted anything about editability at all was a
mobile test grepping `materials.py` for the literal `require_editable_pick(`,
which became vacuous the moment the route moved. These are the behavioural
assertions that outlive a rename:

  - a pick awaiting the customer's decision (`pending`) cannot have its price
    changed underneath them;
  - a pick already committed to an active purchase is frozen, whatever its
    own status says.

Both refusals must leave the stored price untouched — refusing after a partial
write would be worse than not refusing at all.
"""

from __future__ import annotations

import pytest

from sqlalchemy import select

from app.models.entities import (
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Room,
    User,
    UserRole,
)
from app.services import material_price_service

_MUTABLE = {MaterialPickStatus.draft, MaterialPickStatus.approved}


async def _reread(db, pick_id: str) -> MaterialPick:
    """Read the row back through real IO.

    `db.get` can answer from the identity map with an instance the rollback
    expired, and the refresh then fires lazily outside the greenlet context.
    An explicit SELECT does the IO inside the await.
    """
    db.expire_all()
    return (
        await db.execute(select(MaterialPick).where(MaterialPick.id == pick_id))
    ).scalar_one()


async def _seed(
    db,
    suffix: str,
    *,
    status: MaterialPickStatus,
    price: float = 1000,
):
    customer = User(
        id=f"edit-customer-{suffix}",
        phone=f"+781{abs(hash(suffix)) % 10**8:08d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"edit-contractor-{suffix}",
        phone=f"+782{abs(hash(suffix)) % 10**8:08d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"edit-project-{suffix}",
        name="Material price editability",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    room = Room(
        id=f"edit-room-{suffix}",
        project_id=project.id,
        name="Комната",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=0,
    )
    pick = MaterialPick(
        id=f"edit-pick-{suffix}",
        project_id=project.id,
        room_id=room.id,
        name="Материал",
        qty=2,
        unit="шт",
        price=price,
        price_source="manual",
        status=status,
        supply_source="contractor_to_buy",
        qty_available=0,
    )
    db.add_all([customer, contractor, project, room, pick])
    await db.commit()
    return contractor, project, pick


async def _attach_purchase(db, project, pick, status: PurchaseStatus):
    purchase = Purchase(
        id=f"edit-purchase-{pick.id}",
        project_id=project.id,
        supplier_name="Поставщик",
        status=status,
        total_amount=2000,
    )
    db.add(purchase)
    await db.flush()
    db.add(
        PurchaseItem(
            id=f"edit-purchase-item-{pick.id}",
            purchase_id=purchase.id,
            material_pick_id=pick.id,
            name=pick.name,
            qty=pick.qty,
            unit=pick.unit,
            unit_price=pick.price,
        )
    )
    await db.commit()
    return purchase


# --- the statuses that may be priced ----------------------------------------


@pytest.mark.parametrize("status", sorted(_MUTABLE, key=lambda s: s.value))
@pytest.mark.asyncio
async def test_price_can_be_set_while_the_lifecycle_allows_it(db, status):
    contractor, project, pick = await _seed(db, f"allow-{status.value}", status=status)

    updated = await material_price_service.set_manual_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
        price=1500,
    )

    assert updated is not None
    assert updated.price == 1500


# --- the refusals ------------------------------------------------------------


@pytest.mark.parametrize(
    "status",
    sorted(set(MaterialPickStatus) - _MUTABLE, key=lambda s: s.value),
)
@pytest.mark.asyncio
async def test_price_is_refused_outside_the_mutable_statuses(db, status):
    contractor, project, pick = await _seed(db, f"deny-{status.value}", status=status)
    pick_id = pick.id  # `pick` is expired by the rollback below

    with pytest.raises(ValueError) as refusal:
        await material_price_service.set_manual_material_price(
            db,
            project_id=project.id,
            pick_id=pick.id,
            actor_id=contractor.id,
            price=1500,
        )

    assert str(refusal.value) == "material_pick_price_not_editable"

    await db.rollback()
    stored = await _reread(db, pick_id)
    assert stored.price == 1000, "a refused price change must not be partially applied"
    assert stored.status == status


@pytest.mark.parametrize(
    "purchase_status",
    [
        PurchaseStatus.draft,
        PurchaseStatus.approved,
        PurchaseStatus.ordered,
        PurchaseStatus.partial,
    ],
)
@pytest.mark.asyncio
async def test_active_purchase_freezes_the_price_even_in_a_mutable_status(
    db, purchase_status
):
    contractor, project, pick = await _seed(
        db,
        f"locked-{purchase_status.value}",
        status=MaterialPickStatus.approved,
    )
    pick_id = pick.id  # `pick` is expired by the rollback below
    await _attach_purchase(db, project, pick, purchase_status)

    with pytest.raises(ValueError) as refusal:
        await material_price_service.set_manual_material_price(
            db,
            project_id=project.id,
            pick_id=pick.id,
            actor_id=contractor.id,
            price=1500,
        )

    assert str(refusal.value) == "material_pick_locked_by_purchase"

    await db.rollback()
    stored = await _reread(db, pick_id)
    assert stored.price == 1000


@pytest.mark.asyncio
async def test_a_settled_purchase_releases_the_price_again(db):
    """The lock is about *active* purchases; a cancelled one must not freeze."""
    contractor, project, pick = await _seed(
        db,
        "released",
        status=MaterialPickStatus.approved,
    )
    await _attach_purchase(db, project, pick, PurchaseStatus.cancelled)

    updated = await material_price_service.set_manual_material_price(
        db,
        project_id=project.id,
        pick_id=pick.id,
        actor_id=contractor.id,
        price=1500,
    )

    assert updated is not None
    assert updated.price == 1500


# --- scoping -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_pick_in_another_project_is_not_found_rather_than_priced(db):
    contractor, project, pick = await _seed(
        db, "scope", status=MaterialPickStatus.draft
    )
    pick_id = pick.id

    result = await material_price_service.set_manual_material_price(
        db,
        project_id="edit-project-does-not-exist",
        pick_id=pick_id,
        actor_id=contractor.id,
        price=1500,
    )

    assert result is None
    stored = await _reread(db, pick_id)
    assert stored.price == 1000
