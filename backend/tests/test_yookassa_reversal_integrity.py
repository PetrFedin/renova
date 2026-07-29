import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    DomainOutbox,
    Expense,
    Payment,
    PaymentEvent,
    PaymentStatus,
    PaymentType,
    Project,
    Stage,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import budget_service, outbox_service, yookassa_service


@pytest_asyncio.fixture
async def reversal_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(
        id=f"reversal-customer-{suffix}",
        phone=f"+71111{suffix:0>6}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"reversal-contractor-{suffix}",
        phone=f"+70001{suffix:0>6}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"reversal-project-{suffix}",
        name=f"Reversal project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id=f"reversal-stage-{suffix}",
        project_id=project.id,
        name="Отделка",
        sort_order=1,
        payment_amount=5000,
    )
    db.add_all([customer, contractor, project, stage])
    await db.commit()
    return customer, contractor, project, stage


async def seed_payment(
    db,
    *,
    payment_id: str,
    project_id: str,
    stage_id: str,
    created_by: str,
    status: PaymentStatus,
    provider_id: str,
    accepted: bool = False,
):
    stage = await db.get(Stage, stage_id)
    if accepted:
        from app.core.timeutil import utc_now

        stage.customer_accepted_at = utc_now()
    payment = Payment(
        id=payment_id,
        project_id=project_id,
        stage_id=stage_id,
        payment_type=PaymentType.stage,
        status=status,
        title="Оплата отделки",
        amount=5000,
        created_by=created_by,
        yookassa_payment_id=provider_id,
        payment_method="yookassa" if status == PaymentStatus.confirmed else None,
    )
    db.add(payment)
    await db.commit()
    if status == PaymentStatus.confirmed:
        await budget_service.expense_from_payment(db, payment)
        await budget_service.refresh_budget_facts(db, project_id)
        await db.commit()
    return payment


def project_payment_body(*, event: str, status: str, payment_id: str, project_id: str, provider_id: str, amount: str = "5000.00", currency: str = "RUB"):
    return {
        "event": event,
        "object": {
            "id": provider_id,
            "status": status,
            "amount": {"value": amount, "currency": currency},
            "metadata": {
                "kind": "project_payment",
                "payment_id": payment_id,
                "project_id": project_id,
            },
        },
    }


@pytest.mark.asyncio
async def test_success_webhook_has_one_canonical_side_effect_set(reversal_db):
    customer, contractor, project, stage = await seed_project(reversal_db, "101")
    payment = await seed_payment(
        reversal_db,
        payment_id="success-payment",
        project_id=project.id,
        stage_id=stage.id,
        created_by=contractor.id,
        status=PaymentStatus.processing,
        provider_id="yk-success-101",
        accepted=True,
    )
    result = await yookassa_service.process_webhook(
        project_payment_body(
            event="payment.succeeded",
            status="succeeded",
            payment_id=payment.id,
            project_id=project.id,
            provider_id="yk-success-101",
        ),
        reversal_db,
    )
    assert result["confirmed"] is True
    stored = await reversal_db.get(Payment, payment.id)
    assert stored.status == PaymentStatus.confirmed
    assert (await reversal_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await reversal_db.scalar(select(func.count()).select_from(Expense))) == 1
    assert (await reversal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 3
    assert await outbox_service.dispatch_pending(reversal_db, worker_id="success-webhook-worker") == 3
    assert (await reversal_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await reversal_db.scalar(select(func.count()).select_from(AppNotification))) == 2


@pytest.mark.asyncio
async def test_provider_cancellation_is_verified_and_replay_safe(reversal_db):
    _, contractor, project, stage = await seed_project(reversal_db, "201")
    payment = await seed_payment(
        reversal_db,
        payment_id="cancel-payment",
        project_id=project.id,
        stage_id=stage.id,
        created_by=contractor.id,
        status=PaymentStatus.processing,
        provider_id="yk-cancel-201",
    )
    body = project_payment_body(
        event="payment.canceled",
        status="canceled",
        payment_id=payment.id,
        project_id=project.id,
        provider_id="yk-cancel-201",
    )
    body["object"]["cancellation_details"] = {"party": "yoo_money", "reason": "expired_on_confirmation"}

    result = await yookassa_service.process_webhook(body, reversal_db)
    assert result["handled"] is True and result["changed"] is True
    stored = await reversal_db.get(Payment, payment.id)
    assert stored.status == PaymentStatus.cancelled
    event = (
        await reversal_db.execute(select(PaymentEvent).where(PaymentEvent.payment_id == payment.id))
    ).scalar_one()
    assert event.evidence_type == "yookassa_cancellation"
    assert event.evidence_ref == "yk-cancel-201"
    assert "expired_on_confirmation" in (event.note or "")
    assert (await reversal_db.scalar(select(func.count()).select_from(Expense))) == 0
    assert (await reversal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 3

    replay = await yookassa_service.process_webhook(body, reversal_db)
    assert replay["handled"] is True and replay["changed"] is False
    assert replay["reason"] == "replay"
    assert (await reversal_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await reversal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 3


@pytest.mark.asyncio
async def test_full_refund_reverses_expense_and_exact_budget_once(reversal_db):
    _, contractor, project, stage = await seed_project(reversal_db, "301")
    payment = await seed_payment(
        reversal_db,
        payment_id="refund-payment",
        project_id=project.id,
        stage_id=stage.id,
        created_by=contractor.id,
        status=PaymentStatus.confirmed,
        provider_id="yk-refund-payment-301",
        accepted=True,
    )
    stored_project = await reversal_db.get(Project, project.id)
    assert stored_project.budget_spent == 5000
    body = {
        "event": "refund.succeeded",
        "object": {
            "id": "refund-301",
            "status": "succeeded",
            "payment_id": "yk-refund-payment-301",
            "amount": {"value": "5000.00", "currency": "RUB"},
            "metadata": {},
        },
    }

    result = await yookassa_service.process_webhook(body, reversal_db)
    assert result["handled"] is True and result["changed"] is True
    stored = await reversal_db.get(Payment, payment.id)
    assert stored.status == PaymentStatus.refunded
    expense = (
        await reversal_db.execute(select(Expense).where(Expense.payment_id == payment.id))
    ).scalar_one()
    assert expense.status == "refund"
    stored_project = await reversal_db.get(Project, project.id)
    assert stored_project.budget_spent == 0
    event = (
        await reversal_db.execute(select(PaymentEvent).where(PaymentEvent.payment_id == payment.id))
    ).scalar_one()
    assert event.old_status == "confirmed"
    assert event.new_status == "refunded"
    assert event.evidence_type == "yookassa_refund"
    assert event.evidence_ref == "refund-301"
    assert (await reversal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 3

    replay = await yookassa_service.process_webhook(body, reversal_db)
    assert replay["reason"] == "replay"
    assert (await reversal_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await reversal_db.scalar(select(func.count()).select_from(Expense))) == 1
    assert (await reversal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 3


@pytest.mark.asyncio
async def test_partial_refund_is_fail_closed_without_budget_corruption(reversal_db):
    _, contractor, project, stage = await seed_project(reversal_db, "401")
    payment = await seed_payment(
        reversal_db,
        payment_id="partial-refund-payment",
        project_id=project.id,
        stage_id=stage.id,
        created_by=contractor.id,
        status=PaymentStatus.confirmed,
        provider_id="yk-partial-401",
        accepted=True,
    )
    result = await yookassa_service.process_webhook(
        {
            "event": "refund.succeeded",
            "object": {
                "id": "refund-partial-401",
                "status": "succeeded",
                "payment_id": "yk-partial-401",
                "amount": {"value": "1000.00", "currency": "RUB"},
            },
        },
        reversal_db,
    )
    assert result["handled"] is False
    assert result["reason"] == "partial_refund_unsupported"
    stored = await reversal_db.get(Payment, payment.id)
    assert stored.status == PaymentStatus.confirmed
    expense = (
        await reversal_db.execute(select(Expense).where(Expense.payment_id == payment.id))
    ).scalar_one()
    assert expense.status == "confirmed"
    stored_project = await reversal_db.get(Project, project.id)
    assert stored_project.budget_spent == 5000
    assert (await reversal_db.scalar(select(func.count()).select_from(PaymentEvent))) == 0
    assert (await reversal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("amount", "currency", "provider_id", "reason"),
    [
        ("1.00", "RUB", "yk-verify-501", "amount_mismatch"),
        ("5000.00", "USD", "yk-verify-501", "currency_mismatch"),
        ("5000.00", "RUB", "yk-another-501", "yookassa_id_mismatch"),
    ],
)
async def test_cancellation_evidence_mismatch_is_blocked(reversal_db, amount, currency, provider_id, reason):
    _, contractor, project, stage = await seed_project(reversal_db, "501")
    payment = await seed_payment(
        reversal_db,
        payment_id="verify-cancel-payment",
        project_id=project.id,
        stage_id=stage.id,
        created_by=contractor.id,
        status=PaymentStatus.processing,
        provider_id="yk-verify-501",
    )
    result = await yookassa_service.process_webhook(
        project_payment_body(
            event="payment.canceled",
            status="canceled",
            payment_id=payment.id,
            project_id=project.id,
            provider_id=provider_id,
            amount=amount,
            currency=currency,
        ),
        reversal_db,
    )
    assert result["handled"] is False
    assert result["reason"] == reason
    stored = await reversal_db.get(Payment, payment.id)
    assert stored.status == PaymentStatus.processing
    assert (await reversal_db.scalar(select(func.count()).select_from(PaymentEvent))) == 0
    assert (await reversal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 0
