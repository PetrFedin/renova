"""A delivered purchase must not take the project's budget down with it.

`refresh_budget_facts` selected purchases without loading their items, and
`expense_from_purchase` then reads `purchase.items` through three plain,
synchronous helpers — `_single_purchase_field`, `_purchase_title` and the
amount sum. A plain function cannot await a lazy load, so SQLAlchemy raises

    sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called

and the request becomes a 500. Not one endpoint: the whole budget surface of
the project — `os/budget`, `os/budget/lines`, `os/expenses`,
`analytics/expenses-summary`, `analytics/expenses.csv` — from the moment a
single purchase reaches paid or delivered. Payment through the provider rolls
back with it.

The existing purchase tests never saw it because they create the `Purchase` in
the same session that then reads it, so `items` is already in the identity map
and no lazy load happens. That is also why it is not a PostgreSQL-specific
bug, although PostgreSQL is where it was found: the trigger is *the object not
being loaded*, not the driver. `expire_all()` reproduces it on SQLite.

So this test does the one thing the others do not — it expires the session
before reading, which is what an HTTP request does naturally.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    Expense,
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    User,
    UserRole,
)
from app.services import budget_service


@pytest_asyncio.fixture
async def budget_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed(db, suffix: str, status: PurchaseStatus) -> str:
    customer = User(id=f"eager-customer-{suffix}", phone=f"+7911{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"eager-contractor-{suffix}", phone=f"+7922{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"eager-project-{suffix}",
        name="Eager items",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100_000,
    )
    pick = MaterialPick(
        id=f"eager-pick-{suffix}",
        project_id=project.id,
        name="Керамогранит",
        qty=5,
        qty_needed=5,
        qty_delivered=0,
        unit="м²",
        price=1000,
        status=MaterialPickStatus.approved,
        supply_source="contractor_to_buy",
        qty_available=0,
    )
    purchase = Purchase(
        id=f"eager-purchase-{suffix}",
        project_id=project.id,
        supplier_name="Поставщик",
        status=status,
        total_amount=5000,
    )
    db.add_all([customer, contractor, project, pick, purchase])
    await db.flush()
    db.add(
        PurchaseItem(
            id=f"eager-item-{suffix}",
            purchase_id=purchase.id,
            material_pick_id=pick.id,
            name="Керамогранит",
            qty=5,
            unit="м²",
            unit_price=1000,
        )
    )
    await db.commit()
    # Return the id, not the instance: reading `project.id` after expire_all()
    # would itself trigger the lazy refresh this test is trying to observe.
    return project.id


@pytest.mark.parametrize("status", [PurchaseStatus.paid, PurchaseStatus.delivered])
@pytest.mark.asyncio
async def test_budget_refresh_survives_a_purchase_it_did_not_load(budget_db, status):
    """The case the suite was missing: the purchase is not in the identity map."""
    project_id = await _seed(budget_db, f"cold-{status.value}", status)

    # An HTTP request starts with a session that holds nothing. Expiring is the
    # closest equivalent, and it is exactly what the old tests never did.
    budget_db.expire_all()

    await budget_service.refresh_budget_facts(budget_db, project_id)

    expense = (
        await budget_db.execute(
            select(Expense).where(Expense.project_id == project_id)
        )
    ).scalars().first()
    assert expense is not None, "a paid or delivered purchase must produce an expense"
    assert expense.amount == 5000
    assert expense.category == "materials"


@pytest.mark.asyncio
async def test_a_draft_purchase_produces_no_expense(budget_db):
    """Guards the guard: if every status produced an expense the test above
    would pass for the wrong reason."""
    project_id = await _seed(budget_db, "draft", PurchaseStatus.draft)
    budget_db.expire_all()

    await budget_service.refresh_budget_facts(budget_db, project_id)

    expenses = (
        await budget_db.execute(
            select(Expense).where(Expense.project_id == project_id)
        )
    ).scalars().all()
    assert expenses == []


@pytest.mark.asyncio
async def test_the_purchase_items_are_actually_read(budget_db):
    """The expense carries data that only exists on the items.

    Without this, eager loading could be dropped again and the test above would
    still pass if the amount happened to come from `total_amount`.
    """
    project_id = await _seed(budget_db, "detail", PurchaseStatus.delivered)
    budget_db.expire_all()

    await budget_service.refresh_budget_facts(budget_db, project_id)

    expense = (
        await budget_db.execute(
            select(Expense).where(Expense.project_id == project_id)
        )
    ).scalars().one()
    assert expense.material_pick_id == "eager-pick-detail", (
        "material_pick_id is derived from the purchase items, so reading it "
        "proves they were loaded"
    )
