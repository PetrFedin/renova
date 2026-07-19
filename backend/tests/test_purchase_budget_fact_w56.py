"""W56: purchase-ledger должен формировать budget_spent через Expense."""

import pytest
from sqlalchemy import select

from app.models.entities import Expense, Project, Purchase, PurchaseItem, PurchaseStatus, User, UserRole
from app.services import purchase_service

pytestmark = pytest.mark.asyncio


async def _make_project(db, suffix: str) -> Project:
    user = User(phone=f"+79990000{suffix}", role=UserRole.customer, full_name="Budget Fact")
    db.add(user)
    await db.flush()
    project = Project(
        name=f"W56 {suffix}",
        renovation_type="full",
        property_type="apartment",
        customer_id=user.id,
    )
    db.add(project)
    await db.flush()
    return project


async def _make_purchase(db, project_id: str, *, amount: float, supplier_name: str = "Лемана Про") -> Purchase:
    purchase = Purchase(
        project_id=project_id,
        supplier_name=supplier_name,
        status=PurchaseStatus.draft,
        total_amount=amount,
        items=[
            PurchaseItem(
                name="Плитка",
                qty=2,
                unit="шт",
                unit_price=amount / 2,
                room_id="room-1",
                stage_id="stage-1",
            )
        ],
    )
    db.add(purchase)
    await db.commit()
    await db.refresh(purchase, ["items"])
    return purchase


async def _project_expenses(db, project_id: str) -> list[Expense]:
    return list((await db.execute(select(Expense).where(Expense.project_id == project_id))).scalars().all())


async def test_paid_creates_single_purchase_expense_and_cancel_removes_it(db):
    project = await _make_project(db, "01")
    purchase = await _make_purchase(db, project.id, amount=1200)

    await purchase_service.set_status(db, purchase.id, PurchaseStatus.paid)

    expenses = await _project_expenses(db, project.id)
    assert len(expenses) == 1
    assert expenses[0].purchase_id == purchase.id
    assert expenses[0].amount == 1200
    assert expenses[0].title == "Закупка · Лемана Про"

    refreshed_project = await db.get(Project, project.id)
    assert refreshed_project is not None
    assert refreshed_project.budget_spent == 1200

    await purchase_service.set_status(db, purchase.id, PurchaseStatus.delivered)

    expenses = await _project_expenses(db, project.id)
    assert len(expenses) == 1
    assert expenses[0].purchase_id == purchase.id
    assert expenses[0].amount == 1200

    refreshed_project = await db.get(Project, project.id)
    assert refreshed_project is not None
    assert refreshed_project.budget_spent == 1200

    await purchase_service.set_status(db, purchase.id, PurchaseStatus.cancelled)

    expenses = await _project_expenses(db, project.id)
    assert expenses == []

    refreshed_project = await db.get(Project, project.id)
    assert refreshed_project is not None
    assert refreshed_project.budget_spent == 0


async def test_delivered_creates_purchase_expense_when_paid_was_skipped(db):
    project = await _make_project(db, "02")
    purchase = await _make_purchase(db, project.id, amount=3400, supplier_name="Петрович")

    await purchase_service.set_status(db, purchase.id, PurchaseStatus.delivered)

    expenses = await _project_expenses(db, project.id)
    assert len(expenses) == 1
    assert expenses[0].purchase_id == purchase.id
    assert expenses[0].amount == 3400
    assert expenses[0].title == "Закупка · Петрович"

    refreshed_project = await db.get(Project, project.id)
    assert refreshed_project is not None
    assert refreshed_project.budget_spent == 3400
