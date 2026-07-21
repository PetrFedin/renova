"""W64: lock requires propose when contractor assigned."""
import pytest
from app.models.entities import EstimateLine, LineType, Project, User, UserRole
from app.services import estimate_service as est


@pytest.mark.asyncio
async def test_lock_requires_proposal_when_contractor(db):
    cust = User(id="c-w64", phone="+79990006401", role=UserRole.customer)
    contr = User(id="k-w64", phone="+79990006402", role=UserRole.contractor)
    project = Project(
        id="p-w64",
        name="W64",
        renovation_type="cosmetic",
        customer_id=cust.id,
        contractor_id=contr.id,
        budget_planned=1,
        budget_spent=0,
    )
    line = EstimateLine(
        id="el-w64",
        project_id=project.id,
        line_type=LineType.work,
        name="Работа",
        unit="шт",
        quantity_planned=1,
        unit_price=100,
    )
    db.add_all([cust, contr, project, line])
    await db.commit()

    proj, result = await est.lock_estimate(db, project.id, locked_by=cust.id)
    assert result.get("code") == "proposal_required"
    assert proj and proj.estimate_locked_at is None

    await est.propose_estimate_lock(db, project.id, proposed_by=contr.id)
    proj2, result2 = await est.lock_estimate(db, project.id, locked_by=cust.id)
    assert result2.get("code") == "locked"
    assert proj2 and proj2.estimate_locked_at is not None
