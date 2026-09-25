"""Сводка бюджета не должна падать из-за позиций закупки.

`refresh_budget_facts` читала закупки обычным `select(Purchase)`, а
`expense_from_purchase` обращается к `purchase.items` из синхронной функции
`_single_purchase_field`. Без предзагрузки это ленивый запрос вне greenlet —
`MissingGreenlet` и 500 на всём, что считает бюджет.

Воспроизведено на живом сервере (PostgreSQL, реальный проект с оплаченной
закупкой): `GET /api/v1/projects/{id}/reports/final` → 500, в трассировке

    budget_service_legacy.py:389  refresh_budget_facts
    budget_service.py:267         expense_from_purchase
    budget_service_legacy.py:269  _single_purchase_field
    sqlalchemy.exc.MissingGreenlet

Ломалась не одна ручка: через `budget_summary` проходят сводка бюджета,
недельный и финальный отчёты.
"""
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    Expense,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import budget_service

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def facts_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    # Как в проде: app/db/session.py собирает сессии с expire_on_commit=False.
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_paid_purchase(db):
    user = User(id="facts-user", phone="+79990004321", role=UserRole.customer)
    project = Project(
        id="facts-project",
        name="Закупки",
        renovation_type="cosmetic",
        customer_id=user.id,
        budget_spent=0,
    )
    purchase = Purchase(
        id="facts-purchase",
        project_id=project.id,
        supplier_name="Поставщик",
        status=PurchaseStatus.paid,
        total_amount=7000,
    )
    db.add_all([user, project, purchase])
    await db.commit()
    db.add(
        PurchaseItem(
            id="facts-item",
            purchase_id=purchase.id,
            name="Плитка",
            qty=10,
            unit_price=700,
        )
    )
    await db.commit()
    return project


async def test_budget_summary_survives_paid_purchase(facts_db):
    project = await seed_paid_purchase(facts_db)
    # Без предзагрузки `purchase.items` здесь поднимался MissingGreenlet.
    summary = await budget_service.budget_summary(facts_db, project.id)
    assert summary, "сводка бюджета не собралась"


async def test_purchase_becomes_an_expense(facts_db):
    project = await seed_paid_purchase(facts_db)
    await budget_service.budget_summary(facts_db, project.id)

    expenses = list(
        (
            await facts_db.execute(
                select(Expense).where(Expense.project_id == project.id)
            )
        ).scalars().all()
    )
    assert len(expenses) == 1, "оплаченная закупка не попала в факт"
    assert expenses[0].amount == 7000


async def test_items_are_preloaded_not_lazily_read():
    # Храповик: предзагрузка — единственное, что отделяет чтение позиций
    # закупки от ленивого запроса вне greenlet.
    from pathlib import Path

    # Читаем файл, а не атрибут модуля: `budget_service` подменяет
    # `refresh_budget_facts` своей обёрткой, и `inspect` показал бы её.
    from app.services import budget_service_legacy

    source = Path(budget_service_legacy.__file__).read_text(encoding="utf-8")
    body = source[source.index("async def refresh_budget_facts") :]
    body = body[: body.index("\nasync def sync_project_budget_planned")]
    assert "selectinload(Purchase.items)" in body, (
        "позиции закупки снова читаются лениво — сводка бюджета опять упадёт"
    )
