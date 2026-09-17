from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.models.entities import DomainOutbox, Project, User, UserRole, WasteOrder, WasteOrderStatus
from app.services import waste_order_service as waste_svc


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


@pytest.mark.asyncio
async def test_waste_same_target_replay_revalidates_target_role_without_duplicate_effects(db):
    customer = User(
        id=_id("waste-replay-customer"),
        phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=_id("waste-replay-contractor"),
        phone=f"+78{uuid.uuid4().int % 10_000_000_000:010d}",
        role=UserRole.contractor,
    )
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        id=_id("waste-replay-project"),
        name="Waste replay authority",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.flush()
    order = WasteOrder(
        id=_id("waste-replay-order"),
        project_id=project.id,
        volume_m3=2.5,
        waste_type="construction",
        status=WasteOrderStatus.requested,
        price=3500,
        notes="Already requested",
    )
    db.add(order)
    await db.commit()

    customer_id = customer.id
    contractor_id = contractor.id
    project_id = project.id
    order_id = order.id

    current_project = await db.get(Project, project_id, populate_existing=True)
    current_customer = await db.get(User, customer_id, populate_existing=True)
    assert current_project is not None
    assert current_customer is not None
    with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
        await waste_svc.transition_order(
            db,
            project=current_project,
            order_id=order_id,
            actor=current_customer,
            target=WasteOrderStatus.requested,
        )

    assert await db.scalar(
        select(WasteOrder.status).where(WasteOrder.id == order_id)
    ) == WasteOrderStatus.requested
    assert int(await db.scalar(select(func.count()).select_from(DomainOutbox)) or 0) == 0

    current_project = await db.get(Project, project_id, populate_existing=True)
    current_contractor = await db.get(User, contractor_id, populate_existing=True)
    assert current_project is not None
    assert current_contractor is not None
    replay, replayed = await waste_svc.transition_order(
        db,
        project=current_project,
        order_id=order_id,
        actor=current_contractor,
        target=WasteOrderStatus.requested,
    )
    assert replay is not None
    assert replay.id == order_id
    assert replayed is True
    assert int(await db.scalar(select(func.count()).select_from(DomainOutbox)) or 0) == 0
