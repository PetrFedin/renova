"""P2.5: budget-summary BFF service."""
import pytest

from app.models.entities import Project, User, UserRole
from app.services import budget_service as bud


@pytest.mark.asyncio
async def test_budget_hub_payload(db):
    customer = User(id="cust-bff", phone="+79990000001", role=UserRole.customer)
    contractor = User(id="contr-bff", phone="+79990000002", role=UserRole.contractor)
    db.add_all([customer, contractor])
    project = Project(
        id="proj-bff",
        name="BFF Test",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=500000,
        budget_spent=0,
    )
    db.add(project)
    await db.commit()

    data = await bud.budget_hub(db, project.id, threshold_pct=5)
    assert data["summary"]["budget_planned"] >= 0
    assert isinstance(data["payments"], list)
    assert isinstance(data["material_picks"], list)
    assert isinstance(data["budget_alerts"], list)
    assert "pending_payments_count" in data
