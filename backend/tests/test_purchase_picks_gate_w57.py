"""W57: create_from_picks rejects non-approved picks."""
import pytest
from fastapi import HTTPException

from app.api.v1 import purchases
from app.models.entities import MaterialPick, MaterialPickStatus, Project, User, UserRole
from app.services import purchase_service


@pytest.mark.asyncio
async def test_create_from_picks_rejects_draft_without_mutation(db):
    customer = User(id="cust-w57-svc", phone="+70000002001", role=UserRole.customer)
    contractor = User(id="cont-w57-svc", phone="+70000002002", role=UserRole.contractor)
    project = Project(
        id="proj-w57-svc",
        name="W57 service gate",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100000,
        budget_spent=0,
    )
    pick = MaterialPick(
        id="pick-w57-draft",
        project_id=project.id,
        name="Краска",
        qty=5,
        unit="шт",
        price=1200,
        status=MaterialPickStatus.draft,
    )
    db.add_all([customer, contractor, project, pick])
    await db.commit()

    with pytest.raises(ValueError, match="picks_not_approved"):
        await purchase_service.create_from_picks(db, project.id, [pick.id], supplier_name="Леруа")

    refreshed = await db.get(MaterialPick, pick.id)
    assert refreshed is not None
    assert refreshed.status == MaterialPickStatus.draft
    assert await purchase_service.list_purchases(db, project.id) == []


@pytest.mark.asyncio
async def test_create_purchase_route_returns_409_for_pending_pick(db, monkeypatch):
    customer = User(id="cust-w57-api", phone="+70000002011", role=UserRole.customer)
    contractor = User(id="cont-w57-api", phone="+70000002012", role=UserRole.contractor)
    project = Project(
        id="proj-w57-api",
        name="W57 API gate",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100000,
        budget_spent=0,
    )
    pick = MaterialPick(
        id="pick-w57-pending",
        project_id=project.id,
        name="Плитка",
        qty=10,
        unit="м2",
        price=2500,
        status=MaterialPickStatus.pending,
        shop_name="Петрович",
    )
    db.add_all([customer, contractor, project, pick])
    await db.commit()

    async def fake_require_project(*args, **kwargs):
        return project

    monkeypatch.setattr(purchases, "require_project", fake_require_project)

    with pytest.raises(HTTPException) as exc:
        await purchases.create_purchase(
            project.id,
            purchases.CreatePurchaseIn(material_pick_ids=[pick.id], supplier_name="Петрович"),
            contractor,
            db,
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == {
        "code": "picks_not_approved",
        "message": "Сначала согласуйте материалы с заказчиком",
    }

    refreshed = await db.get(MaterialPick, pick.id)
    assert refreshed is not None
    assert refreshed.status == MaterialPickStatus.pending
    assert await purchase_service.list_purchases(db, project.id) == []
