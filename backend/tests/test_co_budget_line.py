"""P3.2c: CO approve creates/updates budget line."""
import pytest
from sqlalchemy import select

from app.models.entities import BudgetLine, ChangeOrderStatus, EstimateLine, LineType, Project, User, UserRole
from app.services import change_order_service as co_svc


@pytest.mark.asyncio
async def test_co_approve_adds_budget_line(db):
    customer = User(id="cust-co", phone="+71111111101", role=UserRole.customer)
    contractor = User(id="contr-co", phone="+71111111102", role=UserRole.contractor)
    db.add_all([customer, contractor])
    project = Project(
        id="proj-co",
        name="CO Test",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100000,
        budget_spent=0,
    )
    db.add(project)
    # W45 SoT: budget_planned = Σ estimate + Σ approved CO (не seed budget_planned)
    db.add(
        EstimateLine(
            project_id=project.id,
            line_type=LineType.work,
            name="База",
            unit="шт",
            quantity_planned=1,
            unit_price=100000,
        )
    )
    await db.commit()

    co = await co_svc.create_order(db, project.id, contractor.id, "Перенос розеток", 15000.0, "Доп. работы")
    assert co.status == ChangeOrderStatus.pending

    approved = await co_svc.approve(db, co.id)
    assert approved is not None
    assert approved.status == ChangeOrderStatus.approved

    await db.refresh(project)
    assert project.budget_planned == 115000.0

    lines = (
        await db.execute(select(BudgetLine).where(BudgetLine.project_id == project.id))
    ).scalars().all()
    co_lines = [bl for bl in lines if "[co:" in bl.description]
    assert len(co_lines) == 1
    assert co_lines[0].planned_amount == 15000.0
    assert co_lines[0].category == "works"


@pytest.mark.asyncio
async def test_co_approve_budget_line_idempotent(db):
    customer = User(id="cust-co2", phone="+72222222201", role=UserRole.customer)
    contractor = User(id="contr-co2", phone="+72222222202", role=UserRole.contractor)
    db.add_all([customer, contractor])
    project = Project(
        id="proj-co2",
        name="CO Test 2",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=50000,
        budget_spent=0,
    )
    db.add(project)
    await db.commit()

    co = await co_svc.create_order(db, project.id, contractor.id, "Штукатурка", 8000.0, None)
    await co_svc.approve(db, co.id)
    second = await co_svc.approve(db, co.id)
    assert second is None

    lines = (
        await db.execute(select(BudgetLine).where(BudgetLine.project_id == project.id))
    ).scalars().all()
    co_lines = [bl for bl in lines if "[co:" in bl.description]
    assert len(co_lines) == 1
