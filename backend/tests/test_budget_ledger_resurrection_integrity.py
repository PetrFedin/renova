import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    Expense,
    MaterialPick,
    MaterialPickStatus,
    Payment,
    PaymentStatus,
    PaymentType,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Receipt,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import budget_service


@pytest_asyncio.fixture
async def ledger_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(
        id=f"ledger-customer-{suffix}",
        phone=f"+77771{suffix:0>6}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"ledger-project-{suffix}",
        name=f"Ledger project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        budget_spent=0,
    )
    db.add_all([customer, project])
    await db.commit()
    return customer, project


async def seed_verified_receipt(db, *, project_id: str, receipt_id: str, amount: float = 5000):
    receipt = Receipt(
        id=receipt_id,
        project_id=project_id,
        amount=amount,
        qr_raw=f"t=20260729T1200&s={amount:.2f}&fn=123&fd=456&fp=789&n=1",
        fn="123",
        fd="456",
        fns_verified=True,
        verification_status="verified_live",
        expense_category="materials",
    )
    db.add(receipt)
    await db.commit()
    return receipt


@pytest.mark.asyncio
@pytest.mark.parametrize("protected_status", ["disputed", "refund", "deleted"])
async def test_verified_receipt_cannot_resurrect_protected_expense(ledger_db, protected_status):
    _, project = await seed_project(ledger_db, protected_status)
    receipt = await seed_verified_receipt(
        ledger_db,
        project_id=project.id,
        receipt_id=f"receipt-{protected_status}",
    )
    expense = Expense(
        id=f"expense-{protected_status}",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Чек 5000 ₽",
        category="materials",
        amount=5000,
        status=protected_status,
        payment_method="card",
    )
    ledger_db.add(expense)
    await ledger_db.commit()

    await budget_service.refresh_budget_facts(ledger_db, project.id)
    await ledger_db.commit()

    stored = await ledger_db.get(Expense, expense.id)
    assert stored.status == protected_status
    assert stored.amount == 5000
    assert (await ledger_db.get(Project, project.id)).budget_spent == 0
    assert (
        await ledger_db.scalar(
            select(func.count()).select_from(Expense).where(Expense.receipt_id == receipt.id)
        )
    ) == 1


@pytest.mark.asyncio
async def test_unrelated_expense_refresh_does_not_restore_old_dispute(ledger_db):
    _, project = await seed_project(ledger_db, "unrelated")
    receipt = await seed_verified_receipt(
        ledger_db,
        project_id=project.id,
        receipt_id="receipt-unrelated",
        amount=8000,
    )
    disputed = Expense(
        id="expense-old-dispute",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Чек 8000 ₽",
        category="materials",
        amount=8000,
        status="disputed",
        payment_method="card",
    )
    unrelated = Expense(
        id="expense-unrelated-confirmed",
        project_id=project.id,
        title="Ручная доставка",
        category="delivery",
        amount=1200,
        status="confirmed",
        payment_method="cash",
    )
    ledger_db.add_all([disputed, unrelated])
    await ledger_db.commit()

    await budget_service.refresh_budget_facts(ledger_db, project.id)
    await ledger_db.commit()

    assert (await ledger_db.get(Expense, disputed.id)).status == "disputed"
    assert (await ledger_db.get(Project, project.id)).budget_spent == 1200


@pytest.mark.asyncio
async def test_protected_duplicate_wins_over_active_duplicate(ledger_db):
    _, project = await seed_project(ledger_db, "duplicate")
    receipt = await seed_verified_receipt(
        ledger_db,
        project_id=project.id,
        receipt_id="receipt-duplicate",
        amount=6400,
    )
    active = Expense(
        id="expense-duplicate-active",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Активный дубль",
        category="materials",
        amount=6400,
        status="confirmed",
    )
    protected = Expense(
        id="expense-duplicate-refund",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Возвращённый факт",
        category="materials",
        amount=6400,
        status="refund",
    )
    ledger_db.add_all([active, protected])
    await ledger_db.commit()

    await budget_service.refresh_budget_facts(ledger_db, project.id)
    await ledger_db.commit()

    rows = list(
        (
            await ledger_db.execute(select(Expense).where(Expense.receipt_id == receipt.id))
        ).scalars().all()
    )
    assert len(rows) == 1
    assert rows[0].id == protected.id
    assert rows[0].status == "refund"
    assert (await ledger_db.get(Project, project.id)).budget_spent == 0


@pytest.mark.asyncio
async def test_payment_and_receipt_hydration_preserve_single_disputed_fact(ledger_db):
    customer, project = await seed_project(ledger_db, "payment")
    payment = Payment(
        id="ledger-payment",
        project_id=project.id,
        payment_type=PaymentType.stage,
        status=PaymentStatus.confirmed,
        title="Оплата этапа",
        amount=9000,
        created_by=customer.id,
    )
    receipt = Receipt(
        id="ledger-payment-receipt",
        project_id=project.id,
        payment_id=payment.id,
        amount=9000,
        qr_raw="t=20260729T1200&s=9000.00&fn=123&fd=456&fp=789&n=1",
        fn="123",
        fd="456",
        fns_verified=True,
        verification_status="verified_live",
        expense_category="works",
    )
    expense = Expense(
        id="ledger-payment-dispute",
        project_id=project.id,
        payment_id=payment.id,
        receipt_id=receipt.id,
        title=payment.title,
        category="works",
        amount=9000,
        status="disputed",
    )
    ledger_db.add_all([payment, receipt, expense])
    await ledger_db.commit()

    await budget_service.refresh_budget_facts(ledger_db, project.id)
    await ledger_db.commit()

    stored = await ledger_db.get(Expense, expense.id)
    assert stored.status == "disputed"
    assert stored.payment_id == payment.id
    assert stored.receipt_id == receipt.id
    assert (await ledger_db.get(Project, project.id)).budget_spent == 0
    assert (await ledger_db.scalar(select(func.count()).select_from(Expense))) == 1


async def seed_paid_purchase(db, *, project: Project, purchase_id: str):
    pick = MaterialPick(
        id=f"pick-{purchase_id}",
        project_id=project.id,
        name="Керамогранит",
        qty=4,
        qty_needed=4,
        unit="м²",
        price=1500,
        status=MaterialPickStatus.approved,
    )
    purchase = Purchase(
        id=purchase_id,
        project_id=project.id,
        supplier_name="Поставщик",
        status=PurchaseStatus.paid,
        total_amount=6000,
    )
    purchase.items = [
        PurchaseItem(
            id=f"item-{purchase_id}",
            purchase=purchase,
            material_pick_id=pick.id,
            name=pick.name,
            qty=4,
            unit="м²",
            unit_price=1500,
        )
    ]
    db.add_all([pick, purchase])
    await db.commit()
    return purchase


@pytest.mark.asyncio
async def test_purchase_refresh_and_stale_cleanup_preserve_refund_evidence(ledger_db):
    _, project = await seed_project(ledger_db, "purchase")
    purchase = await seed_paid_purchase(
        ledger_db,
        project=project,
        purchase_id="ledger-purchase",
    )
    expense = Expense(
        id="ledger-purchase-refund",
        project_id=project.id,
        purchase_id=purchase.id,
        title="Закупка · Поставщик",
        category="materials",
        amount=6000,
        status="refund",
    )
    ledger_db.add(expense)
    await ledger_db.commit()

    await budget_service.refresh_budget_facts(ledger_db, project.id)
    await ledger_db.commit()
    assert (await ledger_db.get(Expense, expense.id)).status == "refund"
    assert (await ledger_db.get(Project, project.id)).budget_spent == 0

    purchase.status = PurchaseStatus.cancelled
    await ledger_db.commit()
    await budget_service.refresh_budget_facts(ledger_db, project.id)
    await ledger_db.commit()

    stored = await ledger_db.get(Expense, expense.id)
    assert stored is not None
    assert stored.status == "refund"
    assert (await ledger_db.get(Project, project.id)).budget_spent == 0


@pytest.mark.asyncio
async def test_active_receipt_still_hydrates_normally(ledger_db):
    _, project = await seed_project(ledger_db, "active")
    receipt = await seed_verified_receipt(
        ledger_db,
        project_id=project.id,
        receipt_id="receipt-active",
        amount=3000,
    )
    expense = Expense(
        id="expense-active",
        project_id=project.id,
        receipt_id=receipt.id,
        title="Чек 2500 ₽",
        category="other",
        amount=2500,
        status="pending_receipt",
    )
    ledger_db.add(expense)
    await ledger_db.commit()

    await budget_service.refresh_budget_facts(ledger_db, project.id)
    await ledger_db.commit()

    stored = await ledger_db.get(Expense, expense.id)
    assert stored.status == "confirmed"
    assert stored.amount == 3000
    assert stored.category == "materials"
    assert (await ledger_db.get(Project, project.id)).budget_spent == 3000
