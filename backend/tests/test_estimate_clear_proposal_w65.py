"""W65: reject/withdraw estimate propose."""
import pytest
from app.models.entities import EstimateLine, LineType, Project, User, UserRole
from app.services import estimate_service as est


@pytest.mark.asyncio
async def test_customer_reject_and_contractor_withdraw(db):
    cust = User(id="c-w65", phone="+79990006501", role=UserRole.customer)
    contr = User(id="k-w65", phone="+79990006502", role=UserRole.contractor)
    project = Project(
        id="p-w65",
        name="W65",
        renovation_type="cosmetic",
        customer_id=cust.id,
        contractor_id=contr.id,
        budget_planned=1,
        budget_spent=0,
    )
    line = EstimateLine(
        id="el-w65",
        project_id=project.id,
        line_type=LineType.work,
        name="Работа",
        unit="шт",
        quantity_planned=1,
        unit_price=100,
    )
    db.add_all([cust, contr, project, line])
    await db.commit()

    await est.propose_estimate_lock(db, project.id, proposed_by=contr.id)
    proj, res = await est.clear_estimate_proposal(db, project.id, cleared_by=cust.id, mode="reject", reason="правка")
    assert res["code"] == "cleared"
    assert proj and proj.estimate_lock_proposed_at is None

    await est.propose_estimate_lock(db, project.id, proposed_by=contr.id)
    proj2, res2 = await est.clear_estimate_proposal(db, project.id, cleared_by=contr.id, mode="withdraw")
    assert res2["code"] == "cleared"
    assert proj2 and proj2.estimate_lock_proposed_at is None
