"""Looking at the budget must not change it.

`budget_summary` serves `GET /os/budget` and the weekly and daily reports. It
re-materialized `projects.budget_planned` from the estimate and committed — on
a read.

Measured on a clean seeded stand, before the fix:

    план ДО                    154 537,70
    после GET /reports/weekly  185 937,70   ← +31 400 ₽, persisted

And worse on a project whose estimate had been emptied: the read wrote 0 and
the plan was gone for good.

The value is already maintained by every mutation that can change it —
estimate lines, room geometry, change-order decisions all call
`sync_project_budget_planned`. The read path only has to compute it.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    EstimateLine,
    Project,
    User,
    UserRole,
)
from app.services import budget_service

STORED_PLAN = 154_537.70


@pytest_asyncio.fixture
async def budget_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed(db, suffix: str, *, with_estimate: bool = True) -> str:
    customer = User(id=f"pr-customer-{suffix}", phone=f"+7988{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"pr-contractor-{suffix}", phone=f"+7977{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"pr-project-{suffix}",
        name="Plan on read",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        # Deliberately out of step with the estimate below, which is what makes
        # an unwanted re-materialization visible.
        budget_planned=STORED_PLAN,
        budget_spent=0,
    )
    db.add_all([customer, contractor, project])
    await db.flush()

    if with_estimate:
        db.add(
            EstimateLine(
                id=f"pr-line-{suffix}",
                project_id=project.id,
                line_type="work",
                name="Работы",
                unit="м²",
                quantity_planned=1,
                unit_price=185_937.70,
            )
        )
    await db.commit()
    return project.id


async def _stored_plan(db, project_id: str) -> float:
    db.expire_all()
    project = (
        await db.execute(select(Project).where(Project.id == project_id))
    ).scalars().one()
    return float(project.budget_planned or 0)


@pytest.mark.asyncio
async def test_reading_the_budget_leaves_the_stored_plan_alone(budget_db):
    project_id = await _seed(budget_db, "shift")

    summary = await budget_service.budget_summary(budget_db, project_id)

    assert await _stored_plan(budget_db, project_id) == pytest.approx(STORED_PLAN), (
        "a read re-materialized the plan and committed it"
    )
    # …while still reporting the derived figure, which is what the screen needs.
    assert summary["budget_planned"] == pytest.approx(185_937.70, abs=0.01)


@pytest.mark.asyncio
async def test_a_project_without_an_estimate_is_not_zeroed_by_a_read(budget_db):
    """The destructive case: the derived value is 0 and the stored one is not."""
    project_id = await _seed(budget_db, "empty", with_estimate=False)

    summary = await budget_service.budget_summary(budget_db, project_id)

    assert await _stored_plan(budget_db, project_id) == pytest.approx(STORED_PLAN), (
        "a read wiped the plan of a project whose estimate was empty"
    )
    assert summary["budget_planned"] == pytest.approx(0.0, abs=0.01)


@pytest.mark.asyncio
async def test_a_mutation_still_materializes_the_plan(budget_db):
    """Guards the guard: if nothing wrote it, the column would drift forever."""
    project_id = await _seed(budget_db, "write")

    written = await budget_service.sync_project_budget_planned(budget_db, project_id)
    await budget_db.commit()

    assert written == pytest.approx(185_937.70, abs=0.01)
    assert await _stored_plan(budget_db, project_id) == pytest.approx(185_937.70, abs=0.01)


@pytest.mark.asyncio
async def test_the_two_agree_on_the_number(budget_db):
    """Compute and sync must not drift apart — one is the other's writer."""
    project_id = await _seed(budget_db, "agree")

    computed = await budget_service.compute_project_budget_planned(budget_db, project_id)
    written = await budget_service.sync_project_budget_planned(budget_db, project_id)

    assert computed == pytest.approx(written, abs=0.001)
