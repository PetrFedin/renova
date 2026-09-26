"""Разбивка бюджета по статьям должна сходиться с итогом «Факт».

Строки бюджета проецируют расходы со статусами «подтверждён» и «ждёт чека»
(`ACTIVE_BUDGET_EXPENSE_STATUSES`), а `projects.budget_spent` считает только
подтверждённые. Обе величины уходят клиенту одним ответом `/os/budget`: сумма
плиток оказывалась больше итога, как только на объекте появлялся чек без
подтверждения ФНС, и объяснить разницу на экране было нечем.

На демо-объекте расхождение не видно — там нет неподтверждённых чеков, сумма
плиток равна итогу (5000 = 5000). Поэтому случай построен здесь.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Expense, Project, User, UserRole
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import budget_service

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def tiles_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(db):
    user = User(id="bt-user", phone="+79996660001", role=UserRole.customer)
    project = Project(
        id="bt-project", name="Объект", renovation_type="cosmetic",
        customer_id=user.id, budget_spent=0,
    )
    db.add_all([user, project])
    await db.commit()
    db.add_all([
        # Подтверждённый расход — входит и в плитку, и в итог.
        Expense(id="bt-ok", project_id=project.id, title="Плитка",
                category="materials", amount=3000, status="confirmed"),
        # Деньги потрачены, чек ещё не подтверждён — входит только в плитку.
        Expense(id="bt-wait", project_id=project.id, title="Клей",
                category="materials", amount=2000, status="pending_receipt"),
    ])
    await db.commit()
    return project


async def test_tiles_sum_matches_the_headline(tiles_db):
    project = await seed(tiles_db)
    summary = await budget_service.budget_summary(tiles_db, project.id)

    tiles = sum(seg["actual"] for seg in summary["segments"].values())
    headline = summary["budget_spent"] + summary["budget_pending_receipt"]
    assert round(tiles, 2) == round(headline, 2), (
        f"плитки {tiles} не сходятся с итогом {headline}: {summary['segments']}"
    )


async def test_headline_still_means_confirmed_only(tiles_db):
    # Что такое «Факт», правкой не меняем: это подтверждённые деньги.
    project = await seed(tiles_db)
    summary = await budget_service.budget_summary(tiles_db, project.id)
    assert summary["budget_spent"] == 3000.0
    assert summary["budget_pending_receipt"] == 2000.0


async def test_every_tile_splits_into_confirmed_and_pending(tiles_db):
    project = await seed(tiles_db)
    summary = await budget_service.budget_summary(tiles_db, project.id)

    materials = summary["segments"]["materials"]
    assert materials["actual"] == 5000.0
    assert materials["confirmed"] == 3000.0
    assert materials["pending"] == 2000.0
    assert round(materials["confirmed"] + materials["pending"], 2) == materials["actual"]


async def test_project_without_unconfirmed_receipts_is_unchanged(tiles_db):
    # Ровно случай демо-объекта: разбивка и итог совпадали и раньше.
    user = User(id="bt-user2", phone="+79996660002", role=UserRole.customer)
    project = Project(id="bt-project2", name="Объект", renovation_type="cosmetic",
                      customer_id=user.id, budget_spent=0)
    tiles_db.add_all([user, project])
    await tiles_db.commit()
    tiles_db.add(Expense(id="bt-only", project_id=project.id, title="Работы",
                         category="works", amount=7000, status="confirmed"))
    await tiles_db.commit()

    summary = await budget_service.budget_summary(tiles_db, project.id)
    assert summary["budget_pending_receipt"] == 0.0
    assert summary["budget_spent"] == 7000.0
    assert summary["segments"]["works"]["pending"] == 0.0
    assert summary["segments"]["works"]["confirmed"] == summary["segments"]["works"]["actual"]


async def test_previous_fields_are_intact(tiles_db):
    project = await seed(tiles_db)
    summary = await budget_service.budget_summary(tiles_db, project.id)
    for key in ("budget_planned", "budget_spent", "reserve", "deviation", "deviation_pct",
                "forecast_total", "forecast_over", "risk", "segments", "remaining",
                "change_orders", "change_orders_approved_sum"):
        assert key in summary, f"из ответа пропало поле {key}"
    for seg in summary["segments"].values():
        assert "planned" in seg and "actual" in seg


@pytest.mark.filterwarnings("ignore::pytest.PytestWarning")
def test_the_two_filters_are_still_different_by_design():
    # Причина расхождения никуда не делась и не должна: «ждёт чека» — это
    # потраченные деньги без подтверждения, и в «Факт» они не входят.
    from app.services.budget_service import ACTIVE_BUDGET_EXPENSE_STATUSES

    assert ACTIVE_BUDGET_EXPENSE_STATUSES == frozenset({"confirmed", "pending_receipt"})
