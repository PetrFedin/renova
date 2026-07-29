import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
    Expense,
    Payment,
    PaymentStatus,
    PaymentType,
    Project,
    Receipt,
    Room,
    Stage,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import activity_service, budget_service, outbox_service, receipt_integrity_service
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def receipt_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(id=f"receipt-customer-{suffix}", phone=f"+76661{suffix:0>6}", role=UserRole.customer)
    contractor = User(id=f"receipt-contractor-{suffix}", phone=f"+75551{suffix:0>6}", role=UserRole.contractor)
    project = Project(
        id=f"receipt-project-{suffix}",
        name=f"Receipt project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    room = Room(
        id=f"receipt-room-{suffix}",
        project_id=project.id,
        name="Кухня",
        length_m=4,
        width_m=3,
    )
    stage = Stage(
        id=f"receipt-stage-{suffix}",
        project_id=project.id,
        name="Отделка",
        sort_order=1,
    )
    db.add_all([customer, contractor, project, room, stage])
    await db.commit()
    return customer, contractor, project, room, stage


async def seed_receipt(
    db,
    *,
    receipt_id: str,
    project_id: str,
    amount: float,
    manual: bool,
    verified: bool,
    room_id: str | None = None,
    stage_id: str | None = None,
    payment_id: str | None = None,
):
    receipt = Receipt(
        id=receipt_id,
        project_id=project_id,
        amount=amount,
        qr_raw="Ручной расход" if manual else "t=20260729T1200&s=3200.00&fn=123&fd=456&fp=789&n=1",
        fn="MANUAL" if manual else "123",
        fd=None if manual else "456",
        fns_verified=verified,
        verification_status="verified_live" if verified and not manual else "saved_unverified",
        expense_category="materials",
        room_id=room_id,
        stage_id=stage_id,
        payment_id=payment_id,
    )
    db.add(receipt)
    await db.flush()
    await budget_service.expense_from_receipt(
        db,
        receipt,
        title=receipt.qr_raw if manual else None,
    )
    await budget_service.refresh_budget_facts(db, project_id)
    await db.commit()
    return receipt


@pytest.mark.asyncio
async def test_receipt_links_and_lookup_are_project_scoped(receipt_db):
    _, _, project_a, room_a, stage_a = await seed_project(receipt_db, "101")
    _, _, project_b, room_b, stage_b = await seed_project(receipt_db, "102")
    receipt = await seed_receipt(
        receipt_db,
        receipt_id="scoped-receipt",
        project_id=project_b.id,
        amount=1000,
        manual=True,
        verified=True,
        room_id=room_b.id,
        stage_id=stage_b.id,
    )

    assert await receipt_integrity_service.get_receipt(
        receipt_db,
        project_id=project_a.id,
        receipt_id=receipt.id,
    ) is None
    assert await receipt_integrity_service.resolve_room_id(
        receipt_db,
        project_id=project_a.id,
        room_id=room_a.id,
    ) == room_a.id
    assert await receipt_integrity_service.resolve_stage_id(
        receipt_db,
        project_id=project_a.id,
        stage_id=stage_a.id,
    ) == stage_a.id
    with pytest.raises(ValueError, match="receipt_room_not_found"):
        await receipt_integrity_service.resolve_room_id(
            receipt_db,
            project_id=project_a.id,
            room_id=room_b.id,
        )
    with pytest.raises(ValueError, match="receipt_stage_not_found"):
        await receipt_integrity_service.resolve_stage_id(
            receipt_db,
            project_id=project_a.id,
            stage_id=stage_b.id,
        )


@pytest.mark.asyncio
async def test_manual_patch_updates_single_expense_and_exact_budget(receipt_db):
    _, _, project, room, stage = await seed_project(receipt_db, "201")
    project_id = project.id
    receipt = await seed_receipt(
        receipt_db,
        receipt_id="manual-patch-receipt",
        project_id=project_id,
        amount=1000,
        manual=True,
        verified=True,
    )

    patched = await receipt_integrity_service.patch_receipt(
        receipt_db,
        project_id=project_id,
        receipt_id=receipt.id,
        expense_category="delivery",
        room_id_supplied=True,
        room_id=room.id,
        stage_id_supplied=True,
        stage_id=stage.id,
        amount=1750,
        description_supplied=True,
        description="Доставка материалов",
    )
    assert patched is not None
    assert patched.amount == 1750
    assert patched.qr_raw == "Доставка материалов"
    expenses = list(
        (
            await receipt_db.execute(select(Expense).where(Expense.receipt_id == receipt.id))
        ).scalars().all()
    )
    assert len(expenses) == 1
    assert expenses[0].amount == 1750
    assert expenses[0].category == "delivery"
    assert expenses[0].room_id == room.id
    assert expenses[0].stage_id == stage.id
    stored_project = await receipt_db.get(Project, project_id)
    assert stored_project.budget_spent == 1750


@pytest.mark.asyncio
async def test_fiscal_receipt_amount_and_description_are_immutable(receipt_db):
    _, _, project, room, stage = await seed_project(receipt_db, "301")
    project_id = project.id
    receipt = await seed_receipt(
        receipt_db,
        receipt_id="immutable-fiscal-receipt",
        project_id=project_id,
        amount=3200,
        manual=False,
        verified=True,
        room_id=room.id,
        stage_id=stage.id,
    )
    receipt_id = receipt.id
    with pytest.raises(ValueError, match="fiscal_receipt_amount_immutable"):
        await receipt_integrity_service.patch_receipt(
            receipt_db,
            project_id=project_id,
            receipt_id=receipt_id,
            expense_category=None,
            room_id_supplied=False,
            room_id=None,
            stage_id_supplied=False,
            stage_id=None,
            amount=1,
            description_supplied=False,
            description=None,
        )
    await receipt_db.rollback()
    with pytest.raises(ValueError, match="fiscal_receipt_description_immutable"):
        await receipt_integrity_service.patch_receipt(
            receipt_db,
            project_id=project_id,
            receipt_id=receipt_id,
            expense_category=None,
            room_id_supplied=False,
            room_id=None,
            stage_id_supplied=False,
            stage_id=None,
            amount=None,
            description_supplied=True,
            description="Подмена",
        )
    await receipt_db.rollback()
    stored = await receipt_db.get(Receipt, receipt_id)
    assert stored.amount == 3200
    assert stored.qr_raw != "Подмена"


@pytest.mark.asyncio
async def test_reverify_reconciles_expense_budget_and_outbox_once(receipt_db):
    customer, _, project, room, stage = await seed_project(receipt_db, "401")
    project_id = project.id
    receipt = await seed_receipt(
        receipt_db,
        receipt_id="reverify-receipt",
        project_id=project_id,
        amount=3200,
        manual=False,
        verified=False,
        room_id=room.id,
        stage_id=stage.id,
    )
    receipt_id = receipt.id
    stored_project = await receipt_db.get(Project, project_id)
    assert stored_project.budget_spent == 0
    expense = (
        await receipt_db.execute(select(Expense).where(Expense.receipt_id == receipt_id))
    ).scalar_one()
    assert expense.status == "pending_receipt"

    mutation = await receipt_integrity_service.apply_verification_result(
        receipt_db,
        project_id=project_id,
        receipt_id=receipt_id,
        actor_id=customer.id,
        verified=True,
        mode="live",
        message="Подтверждено",
    )
    assert mutation.changed is True
    assert mutation.receipt.verification_status == "verified_live"
    expense = (
        await receipt_db.execute(select(Expense).where(Expense.receipt_id == receipt_id))
    ).scalar_one()
    assert expense.status == "confirmed"
    stored_project = await receipt_db.get(Project, project_id)
    assert stored_project.budget_spent == 3200
    assert (await receipt_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    await activity_service.log_event(
        receipt_db,
        project_id=project_id,
        user_id=customer.id,
        kind="ReceiptVerified",
        title="Чек подтверждён ФНС",
        body="Подтверждено",
        room_id=room.id,
        link_path="/(customer)/(tabs)/budget",
    )
    clear_request_side_effect_context()
    assert await outbox_service.dispatch_pending(receipt_db, worker_id="receipt-verify-worker") == 1
    assert (await receipt_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1

    replay = await receipt_integrity_service.apply_verification_result(
        receipt_db,
        project_id=project_id,
        receipt_id=receipt_id,
        actor_id=customer.id,
        verified=True,
        mode="live",
        message="Подтверждено",
    )
    assert replay.changed is False
    assert (await receipt_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    failed = await receipt_integrity_service.apply_verification_result(
        receipt_db,
        project_id=project_id,
        receipt_id=receipt_id,
        actor_id=customer.id,
        verified=False,
        mode="live",
        message="Не найден",
    )
    assert failed.changed is True
    expense = (
        await receipt_db.execute(select(Expense).where(Expense.receipt_id == receipt_id))
    ).scalar_one()
    assert expense.status == "pending_receipt"
    stored_project = await receipt_db.get(Project, project_id)
    assert stored_project.budget_spent == 0
    assert (await receipt_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2
    clear_request_side_effect_context()


@pytest.mark.asyncio
async def test_delete_reverses_fact_but_confirmed_payment_receipt_is_locked(receipt_db):
    customer, contractor, project, room, stage = await seed_project(receipt_db, "501")
    project_id = project.id
    customer_id = customer.id
    contractor_id = contractor.id
    stage_id = stage.id
    room_id = room.id
    deletable = await seed_receipt(
        receipt_db,
        receipt_id="deletable-receipt",
        project_id=project_id,
        amount=2100,
        manual=True,
        verified=True,
        room_id=room_id,
        stage_id=stage_id,
    )
    deletable_id = deletable.id
    result = await receipt_integrity_service.delete_receipt(
        receipt_db,
        project_id=project_id,
        receipt_id=deletable_id,
        actor_id=customer_id,
    )
    assert result is not None and result.amount == 2100
    assert await receipt_db.get(Receipt, deletable_id) is None
    assert (await receipt_db.scalar(select(func.count()).select_from(Expense))) == 0
    stored_project = await receipt_db.get(Project, project_id)
    assert stored_project.budget_spent == 0
    assert (await receipt_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    await activity_service.log_event(
        receipt_db,
        project_id=project_id,
        user_id=customer_id,
        kind="ExpenseRemoved",
        title="Чек удалён",
        body="2100.0",
        link_path="/(customer)/(tabs)/budget",
    )
    clear_request_side_effect_context()
    assert await outbox_service.dispatch_pending(receipt_db, worker_id="receipt-delete-worker") == 1
    assert (await receipt_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1

    payment = Payment(
        id="confirmed-receipt-payment",
        project_id=project_id,
        stage_id=stage_id,
        payment_type=PaymentType.stage,
        status=PaymentStatus.confirmed,
        title="Этап",
        amount=5000,
        created_by=contractor_id,
    )
    payment_id = payment.id
    receipt_db.add(payment)
    await receipt_db.commit()
    locked = await seed_receipt(
        receipt_db,
        receipt_id="locked-payment-receipt",
        project_id=project_id,
        amount=5000,
        manual=False,
        verified=True,
        room_id=room_id,
        stage_id=stage_id,
        payment_id=payment_id,
    )
    locked_id = locked.id
    with pytest.raises(ValueError, match="confirmed_payment_receipt_locked"):
        await receipt_integrity_service.delete_receipt(
            receipt_db,
            project_id=project_id,
            receipt_id=locked_id,
            actor_id=customer_id,
        )
    await receipt_db.rollback()
    assert await receipt_db.get(Receipt, locked_id) is not None
