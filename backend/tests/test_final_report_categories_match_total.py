"""Расходы по статьям в финальном отчёте обязаны складываться в «Факт».

Разбивка считалась по таблице `Receipt`, а «Факт» и «Всего операций» — по
`Expense`. Это две разные вселенные: чеки — лишь один из источников расходов
(ещё есть платежи, закупки и расходы, заведённые вручную), и неподтверждённый
чек в «Факт» не входит, а в разбивку входил.

Клиент получал отчёт, где столбик статей не сходится с итогом. Потери данных
при переходе на `Expense` нет: каждый чек проецируется в расход через
`expense_from_receipt` — со своей категорией и суммой.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Expense, Project, Receipt, User, UserRole
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import report_service
# Инвариант «подтверждён = verified_live» держится ORM-слушателем; без импорта
# он встаёт на место только когда модуль подтянет кто-то другой, и тест начинает
# зависеть от порядка запуска.
import app.services.fns.receipt_truth_events  # noqa: F401

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def report_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(db):
    user = User(id="report-user", phone="+79990001234", role=UserRole.customer)
    project = Project(
        id="report-project",
        name="Отчёт",
        renovation_type="cosmetic",
        customer_id=user.id,
        budget_spent=0,
    )
    db.add_all([user, project])
    await db.commit()

    # Чек с подтверждением ФНС — в «Факт» входит.
    db.add(
        Receipt(
            id="receipt-verified",
            project_id=project.id,
            amount=3000,
            expense_category="materials",
            # Только «verified_live» считается подтверждением: см.
            # `receipt_truth_events` — одного флага мало, и это правильно.
            fns_verified=True,
            verification_status="verified_live",
        )
    )
    # Чек без подтверждения — в «Факт» не входит, и в статьях его быть не должно.
    db.add(
        Receipt(
            id="receipt-unverified",
            project_id=project.id,
            amount=5000,
            expense_category="labor",
            fns_verified=False,
        )
    )
    # Расход мимо чеков: в старой разбивке его не существовало вовсе.
    db.add(
        Expense(
            id="expense-manual",
            project_id=project.id,
            title="Оплата этапа",
            category="works",
            amount=2000,
            status="confirmed",
        )
    )
    await db.commit()
    # В проде отчёт собирается на свежей сессии: объекты приходят запросом, а не
    # остаются от создания. Без этого `final_report` читал бы наши же объекты и
    # проверка шла бы мимо настоящего пути.
    db.expunge_all()
    return project


async def test_categories_sum_equals_reported_fact(report_db):
    project = await seed(report_db)
    data = await report_service.final_report(report_db, project.id)

    by_category = {row["category"]: row["total"] for row in data["expenses_by_category"]}
    assert round(sum(by_category.values()), 2) == data["budget_spent"], (
        f"статьи {by_category} не складываются в «Факт» {data['budget_spent']}"
    )
    assert round(sum(by_category.values()), 2) == data["expenses_total"]


async def test_unconfirmed_receipt_stays_out_of_both(report_db):
    project = await seed(report_db)
    data = await report_service.final_report(report_db, project.id)

    by_category = {row["category"]: row["total"] for row in data["expenses_by_category"]}
    assert by_category.get("labor") is None, (
        "неподтверждённый чек попал в статьи, хотя в «Факт» он не входит"
    )
    assert data["budget_spent"] == 5000.0  # 3000 чек + 2000 расход, но не 5000 чека
    assert by_category["materials"] == 3000.0


async def test_expense_outside_receipts_is_counted(report_db):
    project = await seed(report_db)
    data = await report_service.final_report(report_db, project.id)

    by_category = {row["category"]: row["total"] for row in data["expenses_by_category"]}
    assert by_category.get("works") == 2000.0, (
        "расход мимо чеков не виден в статьях — разбивка снова считает только чеки"
    )
    assert data["expenses_count"] == 2, "«Всего операций» считает не те же строки"


async def test_every_category_has_a_russian_label():
    # «works» и «labor» — одни и те же работы из разных источников; обе статьи
    # обязаны выйти в отчёт словами, а не ключом латиницей.
    for key in ("works", "labor", "materials", "delivery", "tools", "other"):
        label = report_service.EXPENSE_CATEGORY_LABELS.get(key)
        assert label and label != key, f"статья {key} выйдет в отчёт латиницей"


async def test_breakdown_no_longer_reads_receipts_directly():
    import inspect

    source = inspect.getsource(report_service._expenses_by_category)
    assert "Receipt" not in source, (
        "разбивка снова читает чеки напрямую — итог и статьи опять разойдутся"
    )
