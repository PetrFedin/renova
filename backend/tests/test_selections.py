"""P2.2: selections tracker flow."""
import pytest

from app.models.entities import Project, SelectionItem, SelectionStatus, User, UserRole


@pytest.mark.asyncio
async def test_selection_propose_approve(db):
    customer = User(id="cust-sel", phone="+79993333331", role=UserRole.customer)
    contractor = User(id="contr-sel", phone="+79993333332", role=UserRole.contractor)
    db.add_all([customer, contractor])
    project = Project(
        id="proj-sel",
        name="Selections",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=200000,
        budget_spent=0,
    )
    db.add(project)
    await db.commit()

    row = SelectionItem(
        project_id=project.id,
        title="Плитка Kerama",
        category="tile",
        price=4500,
        allowance=4000,
        status=SelectionStatus.draft,
        proposed_by_id=contractor.id,
    )
    db.add(row)
    await db.commit()

    row.status = SelectionStatus.proposed
    await db.commit()

    row.status = SelectionStatus.approved
    from datetime import datetime
    row.approved_at = datetime.utcnow()
    await db.commit()
    await db.refresh(row)

    assert row.status == SelectionStatus.approved
    assert row.approved_at is not None
    assert row.price > (row.allowance or 0)


@pytest.mark.asyncio
async def test_approved_selection_creates_material_pick(db):
    from app.models.entities import MaterialPick
    from app.services.selection_service import material_pick_from_selection

    customer = User(id="cust-sel2", phone="+79994444441", role=UserRole.customer)
    db.add(customer)
    project = Project(
        id="proj-sel2",
        name="Pick link",
        renovation_type="cosmetic",
        customer_id=customer.id,
        budget_planned=100000,
        budget_spent=0,
    )
    db.add(project)
    await db.commit()

    row = SelectionItem(
        project_id=project.id,
        title="Смеситель Grohe",
        category="plumbing",
        price=12000,
        allowance=15000,
        status=SelectionStatus.approved,
    )
    db.add(row)
    await db.flush()

    pick = await material_pick_from_selection(db, row)
    await db.commit()

    assert pick.id
    assert pick.name == "Смеситель Grohe"
    assert pick.status.value == "approved"
    refreshed = await db.get(MaterialPick, pick.id)
    assert refreshed is not None
