import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    BudgetLine,
    ChangeOrder,
    ChangeOrderStatus,
    EstimateLine,
    LineType,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
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
async def planned_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(
        id=f"planned-customer-{suffix}",
        phone=f"+75551{len(suffix):0>6}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"planned-project-{suffix}",
        name=f"Planned precision {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    room = Room(
        id=f"planned-room-{suffix}",
        project_id=project.id,
        name="Комната",
        length_m=4,
        width_m=3,
    )
    db.add_all([customer, project, room])
    await db.commit()
    return customer, project, room


@pytest.mark.asyncio
async def test_estimate_change_order_and_project_plan_share_one_decimal_contract(planned_db):
    customer, project, room = await seed_project(planned_db, "combined")
    estimate = EstimateLine(
        id="planned-estimate-combined",
        project_id=project.id,
        room_id=room.id,
        line_type=LineType.material,
        name="Дробный объём",
        unit="м²",
        quantity_planned=1.125,
        unit_price=100,
    )
    order = ChangeOrder(
        id="planned-change-order-combined",
        project_id=project.id,
        title="Точная доплата",
        amount=10.005,
        status=ChangeOrderStatus.approved,
        created_by=customer.id,
    )
    planned_db.add_all([estimate, order])
    await planned_db.commit()

    await budget_service.sync_budget_lines_from_estimate(planned_db, project.id)
    await budget_service.apply_change_order_to_budget(planned_db, order)
    await planned_db.commit()

    planned_db.add(
        BudgetLine(
            id="planned-change-order-duplicate",
            project_id=project.id,
            category="works",
            description=f"Старый дубль [co:{order.id}]",
            planned_amount=999,
            expense_type="works",
        )
    )
    await planned_db.commit()

    await budget_service.apply_change_order_to_budget(planned_db, order)
    total = await budget_service.sync_project_budget_planned(planned_db, project.id)
    await planned_db.commit()

    estimate_line = await planned_db.scalar(
        select(BudgetLine).where(BudgetLine.estimate_line_id == estimate.id)
    )
    reserve = await planned_db.scalar(
        select(BudgetLine).where(
            BudgetLine.project_id == project.id,
            BudgetLine.category == "reserve",
        )
    )
    change_order_lines = list(
        (
            await planned_db.execute(
                select(BudgetLine).where(
                    BudgetLine.project_id == project.id,
                    BudgetLine.description.contains(f"[co:{order.id}]"),
                )
            )
        ).scalars().all()
    )

    assert estimate_line.planned_amount == 112.5
    assert reserve.planned_amount == 13.5
    assert len(change_order_lines) == 1
    assert change_order_lines[0].planned_amount == 10.01
    assert total == 122.51
    assert (await planned_db.get(Project, project.id)).budget_planned == 122.51
    assert round(estimate_line.planned_amount + change_order_lines[0].planned_amount, 2) == total


@pytest.mark.asyncio
async def test_purchase_item_fallback_uses_half_up_money_rounding(planned_db):
    _, project, _ = await seed_project(planned_db, "purchase")
    purchase = Purchase(
        id="planned-purchase-precision",
        project_id=project.id,
        supplier_name="Поставщик",
        status=PurchaseStatus.paid,
        total_amount=0,
    )
    purchase.items = [
        PurchaseItem(
            id="planned-purchase-item-precision",
            purchase=purchase,
            name="Материал",
            qty=1.125,
            unit="м²",
            unit_price=8.04,
        )
    ]
    planned_db.add(purchase)
    await planned_db.commit()

    expense = await budget_service.expense_from_purchase(planned_db, purchase)
    await planned_db.commit()

    assert expense is not None
    assert expense.amount == 9.05
