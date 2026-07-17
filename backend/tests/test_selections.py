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
