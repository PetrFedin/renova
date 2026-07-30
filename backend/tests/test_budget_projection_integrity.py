import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    BudgetLine,
    EstimateLine,
    Expense,
    LineType,
    Project,
    Room,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import budget_service


@pytest_asyncio.fixture
async def projection_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project_room(db, suffix: str):
    user = User(
        id=f"projection-user-{suffix}",
        phone=f"+7999000{len(suffix):04d}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"projection-project-{suffix}",
        name=f"Projection {suffix}",
        renovation_type="cosmetic",
        customer_id=user.id,
        budget_spent=0,
    )
    room = Room(
        id=f"projection-room-{suffix}",
        project_id=project.id,
        name="Комната",
        length_m=4,
        width_m=3,
    )
    db.add_all([user, project, room])
    await db.commit()
    return project, room


def estimate_line(*, line_id: str, project_id: str, room_id: str, name: str, price: float):
    return EstimateLine(
        id=line_id,
        project_id=project_id,
        room_id=room_id,
        line_type=LineType.material,
        name=name,
        unit="шт",
        quantity_planned=1,
        unit_price=price,
    )


def manual_expense(
    *,
    expense_id: str,
    project_id: str,
    room_id: str | None,
    amount: float,
    status: str = "confirmed",
    category: str = "materials",
):
    return Expense(
        id=expense_id,
        project_id=project_id,
        room_id=room_id,
        title="Ручной расход",
        category=category,
        amount=amount,
        status=status,
        payment_method="cash",
    )


@pytest.mark.asyncio
async def test_single_matching_estimate_line_receives_expense_once(projection_db):
    project, room = await seed_project_room(projection_db, "single")
    line = estimate_line(
        line_id="estimate-single",
        project_id=project.id,
        room_id=room.id,
        name="Плитка",
        price=500,
    )
    expense = manual_expense(
        expense_id="expense-single",
        project_id=project.id,
        room_id=room.id,
        amount=120,
    )
    projection_db.add_all([line, expense])
    await projection_db.commit()

    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    rows = list(
        (
            await projection_db.execute(
                select(BudgetLine).where(BudgetLine.project_id == project.id)
            )
        ).scalars().all()
    )
    estimate_projection = next(row for row in rows if row.estimate_line_id == line.id)
    assert estimate_projection.actual_amount == 120
    assert not any((row.description or "").startswith("[actual-unallocated:") for row in rows)
    assert (await projection_db.get(Project, project.id)).budget_spent == 120


@pytest.mark.asyncio
async def test_ambiguous_room_category_expense_is_not_multiplied_across_estimate_lines(projection_db):
    project, room = await seed_project_room(projection_db, "ambiguous")
    first = estimate_line(
        line_id="estimate-ambiguous-a",
        project_id=project.id,
        room_id=room.id,
        name="Плитка",
        price=500,
    )
    second = estimate_line(
        line_id="estimate-ambiguous-b",
        project_id=project.id,
        room_id=room.id,
        name="Клей",
        price=200,
    )
    expense = manual_expense(
        expense_id="expense-ambiguous",
        project_id=project.id,
        room_id=room.id,
        amount=120,
    )
    projection_db.add_all([first, second, expense])
    await projection_db.commit()

    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()
    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    rows = list(
        (
            await projection_db.execute(
                select(BudgetLine).where(
                    BudgetLine.project_id == project.id,
                    BudgetLine.category == "materials",
                )
            )
        ).scalars().all()
    )
    estimate_rows = [row for row in rows if row.estimate_line_id]
    fallback_rows = [
        row for row in rows if (row.description or "").startswith("[actual-unallocated:")
    ]

    assert [row.actual_amount for row in estimate_rows] == [0, 0]
    assert len(fallback_rows) == 1
    assert fallback_rows[0].actual_amount == 120
    assert round(sum(row.actual_amount for row in rows), 2) == 120
    assert (await projection_db.get(Project, project.id)).budget_spent == 120


@pytest.mark.asyncio
async def test_deleted_estimate_line_does_not_survive_budget_projection(projection_db):
    project, room = await seed_project_room(projection_db, "stale")
    keep = estimate_line(
        line_id="estimate-stale-keep",
        project_id=project.id,
        room_id=room.id,
        name="Остаётся",
        price=500,
    )
    remove = estimate_line(
        line_id="estimate-stale-remove",
        project_id=project.id,
        room_id=room.id,
        name="Удаляется",
        price=300,
    )
    projection_db.add_all([keep, remove])
    await projection_db.commit()
    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    await projection_db.delete(remove)
    await projection_db.commit()
    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    rows = list(
        (
            await projection_db.execute(
                select(BudgetLine).where(BudgetLine.project_id == project.id)
            )
        ).scalars().all()
    )
    assert not any(row.estimate_line_id == remove.id for row in rows)
    assert sum(row.planned_amount for row in rows if row.category != "reserve") == 500


@pytest.mark.asyncio
async def test_duplicate_budget_projection_for_same_estimate_line_is_collapsed(projection_db):
    project, room = await seed_project_room(projection_db, "duplicate")
    line = estimate_line(
        line_id="estimate-duplicate",
        project_id=project.id,
        room_id=room.id,
        name="Штукатурка",
        price=700,
    )
    projection_db.add(line)
    await projection_db.commit()
    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    projection_db.add(
        BudgetLine(
            id="budget-duplicate-extra",
            project_id=project.id,
            room_id=room.id,
            estimate_line_id=line.id,
            category="materials",
            description="Дубль",
            planned_amount=999,
            actual_amount=999,
            expense_type="materials",
        )
    )
    await projection_db.commit()

    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    rows = list(
        (
            await projection_db.execute(
                select(BudgetLine).where(BudgetLine.estimate_line_id == line.id)
            )
        ).scalars().all()
    )
    assert len(rows) == 1
    assert rows[0].planned_amount == 700


@pytest.mark.asyncio
async def test_pending_receipt_is_projected_but_not_counted_as_spent(projection_db):
    project, room = await seed_project_room(projection_db, "pending")
    first = estimate_line(
        line_id="estimate-pending-a",
        project_id=project.id,
        room_id=room.id,
        name="Материал A",
        price=100,
    )
    second = estimate_line(
        line_id="estimate-pending-b",
        project_id=project.id,
        room_id=room.id,
        name="Материал B",
        price=100,
    )
    pending = manual_expense(
        expense_id="expense-pending",
        project_id=project.id,
        room_id=room.id,
        amount=50,
        status="pending_receipt",
    )
    projection_db.add_all([first, second, pending])
    await projection_db.commit()

    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    rows = list(
        (
            await projection_db.execute(
                select(BudgetLine).where(BudgetLine.project_id == project.id)
            )
        ).scalars().all()
    )
    assert round(sum(row.actual_amount for row in rows), 2) == 50
    assert (await projection_db.get(Project, project.id)).budget_spent == 0


@pytest.mark.asyncio
async def test_expense_amounts_use_half_up_cent_rounding(projection_db):
    project, room = await seed_project_room(projection_db, "rounding")
    line = estimate_line(
        line_id="estimate-rounding",
        project_id=project.id,
        room_id=room.id,
        name="Мелкий расход",
        price=100,
    )
    expense = manual_expense(
        expense_id="expense-rounding",
        project_id=project.id,
        room_id=room.id,
        amount=10.005,
    )
    projection_db.add_all([line, expense])
    await projection_db.commit()

    await budget_service.refresh_budget_facts(projection_db, project.id)
    await projection_db.commit()

    budget_line = await projection_db.scalar(
        select(BudgetLine).where(BudgetLine.estimate_line_id == line.id)
    )
    assert budget_line.actual_amount == 10.01
    assert (await projection_db.get(Project, project.id)).budget_spent == 10.01
