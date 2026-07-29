import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import payment_disputes
from app.api.v1.router import api_router
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
    Receipt,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import outbox_service
from app.services import payment_dispute_service as disputes
from app.services import payment_reversal_service as reversals


@pytest_asyncio.fixture
async def dispute_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(
        id=f"dispute-customer-{suffix}",
        phone=f"+73331{suffix:0>6}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"dispute-contractor-{suffix}",
        phone=f"+74441{suffix:0>6}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"dispute-project-{suffix}",
        name=f"Dispute project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_spent=0,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


async def seed_payment(
    db,
    *,
    payment_id: str,
    project: Project,
    created_by: str,
    status: PaymentStatus,
    with_expense: bool,
    with_receipt: bool = False,
    provider_id: str | None = None,
):
    payment = Payment(
        id=payment_id,
        project_id=project.id,
        payment_type=PaymentType.stage,
        status=status,
        title="Оплата отделочных работ",
        amount=5000,
        created_by=created_by,
        payment_method="yookassa" if provider_id else "bank_transfer",
        yookassa_payment_id=provider_id,
    )
    db.add(payment)
    receipt = None
    if with_receipt:
        receipt = Receipt(
            id=f"receipt-{payment_id}",
            project_id=project.id,
            amount=5000,
            fns_verified=True,
            verification_status="verified_live",
            payment_id=payment.id,
        )
        db.add(receipt)
    if with_expense:
        db.add(
            Expense(
                id=f"expense-{payment_id}",
                project_id=project.id,
                payment_id=payment.id,
                receipt_id=receipt.id if receipt else None,
                title=payment.title,
                category="works",
                amount=5000,
                status="confirmed",
                payment_method=payment.payment_method,
            )
        )
        project.budget_spent = 5000
    await db.commit()
    return payment


@pytest.mark.asyncio
async def test_confirmed_dispute_is_atomic_budget_safe_and_replay_safe(dispute_db):
    customer, _, project = await seed_project(dispute_db, "101")
    payment = await seed_payment(
        dispute_db,
        payment_id="confirmed-dispute-payment",
        project=project,
        created_by=customer.id,
        status=PaymentStatus.confirmed,
        with_expense=True,
        with_receipt=True,
    )
    reason = "Работы имеют существенные недостатки и не были приняты заказчиком"

    result = await disputes.dispute_payment(
        dispute_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason=reason,
    )
    assert result and result.changed is True and result.replayed is False
    stored_payment = await dispute_db.get(Payment, payment.id)
    assert stored_payment.status == PaymentStatus.disputed
    expense = (
        await dispute_db.execute(select(Expense).where(Expense.payment_id == payment.id))
    ).scalar_one()
    assert expense.status == "disputed"
    assert expense.receipt_id == f"receipt-{payment.id}"
    stored_project = await dispute_db.get(Project, project.id)
    assert stored_project.budget_spent == 0

    event = (
        await dispute_db.execute(select(PaymentEvent).where(PaymentEvent.payment_id == payment.id))
    ).scalar_one()
    assert event.old_status == "confirmed"
    assert event.new_status == "disputed"
    assert event.actor_user_id == customer.id
    assert event.source == "manual"
    assert event.evidence_type == "customer_dispute"
    assert event.note == reason
    assert (await dispute_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    replay = await disputes.dispute_payment(
        dispute_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason=f"  {reason}  ",
    )
    assert replay and replay.replayed is True and replay.changed is False
    assert (await dispute_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await dispute_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    with pytest.raises(ValueError, match="payment_dispute_already_open"):
        await disputes.dispute_payment(
            dispute_db,
            project_id=project.id,
            payment_id=payment.id,
            actor_user_id=customer.id,
            reason="Другая причина не должна заменять уже открытый доказательный спор",
        )
    await dispute_db.rollback()

    assert await outbox_service.dispatch_pending(dispute_db, worker_id="dispute-worker") == 2
    assert (await dispute_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await dispute_db.scalar(select(func.count()).select_from(AppNotification))) == 1


@pytest.mark.asyncio
async def test_paid_unverified_dispute_does_not_create_expense_or_budget(dispute_db):
    customer, _, project = await seed_project(dispute_db, "201")
    payment = await seed_payment(
        dispute_db,
        payment_id="unverified-dispute-payment",
        project=project,
        created_by=customer.id,
        status=PaymentStatus.paid_unverified,
        with_expense=False,
    )

    result = await disputes.dispute_payment(
        dispute_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason="Перевод отмечен ошибочно, подтверждающих документов нет",
    )
    assert result and result.changed is True
    assert (await dispute_db.get(Payment, payment.id)).status == PaymentStatus.disputed
    assert (await dispute_db.scalar(select(func.count()).select_from(Expense))) == 0
    assert (await dispute_db.get(Project, project.id)).budget_spent == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [
        PaymentStatus.pending,
        PaymentStatus.processing,
        PaymentStatus.cancelled,
        PaymentStatus.refunded,
    ],
)
async def test_invalid_dispute_transitions_are_blocked(dispute_db, status):
    customer, _, project = await seed_project(dispute_db, status.value)
    payment = await seed_payment(
        dispute_db,
        payment_id=f"blocked-{status.value}",
        project=project,
        created_by=customer.id,
        status=status,
        with_expense=False,
    )
    project_id = project.id
    payment_id = payment.id
    customer_id = customer.id
    with pytest.raises(ValueError, match=f"payment_dispute_transition_blocked:{status.value}"):
        await disputes.dispute_payment(
            dispute_db,
            project_id=project_id,
            payment_id=payment_id,
            actor_user_id=customer_id,
            reason="Этот переход должен быть запрещён финансовой машиной состояний",
        )
    await dispute_db.rollback()
    assert (await dispute_db.get(Payment, payment_id)).status == status
    assert (await dispute_db.scalar(select(func.count()).select_from(PaymentEvent))) == 0


@pytest.mark.asyncio
async def test_non_customer_cannot_open_dispute_through_api(dispute_db):
    _, contractor, project = await seed_project(dispute_db, "301")
    payment = await seed_payment(
        dispute_db,
        payment_id="contractor-dispute-payment",
        project=project,
        created_by=contractor.id,
        status=PaymentStatus.confirmed,
        with_expense=True,
    )
    with pytest.raises(HTTPException) as exc_info:
        await payment_disputes.dispute_payment(
            project_id=project.id,
            payment_id=payment.id,
            body=payment_disputes.PaymentDisputeIn(
                reason="Исполнитель не может открыть спор от имени заказчика",
            ),
            user=contractor,
            db=dispute_db,
        )
    assert exc_info.value.status_code == 403
    assert (await dispute_db.get(Payment, payment.id)).status == PaymentStatus.confirmed


@pytest.mark.asyncio
async def test_provider_full_refund_closes_open_dispute_without_budget_resurrection(dispute_db):
    customer, _, project = await seed_project(dispute_db, "401")
    payment = await seed_payment(
        dispute_db,
        payment_id="disputed-refund-payment",
        project=project,
        created_by=customer.id,
        status=PaymentStatus.confirmed,
        with_expense=True,
        with_receipt=True,
        provider_id="yk-disputed-refund-401",
    )
    await disputes.dispute_payment(
        dispute_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason="Оплата оспорена до завершения полного возврата провайдером",
    )

    result = await reversals.apply_provider_refund(
        dispute_db,
        yookassa_payment_id="yk-disputed-refund-401",
        refund_id="refund-after-dispute-401",
        amount=5000,
        currency="RUB",
    )
    assert result.handled is True and result.changed is True
    assert (await dispute_db.get(Payment, payment.id)).status == PaymentStatus.refunded
    expense = (
        await dispute_db.execute(select(Expense).where(Expense.payment_id == payment.id))
    ).scalar_one()
    assert expense.status == "refund"
    assert expense.receipt_id == f"receipt-{payment.id}"
    assert (await dispute_db.get(Project, project.id)).budget_spent == 0
    events = list(
        (
            await dispute_db.execute(
                select(PaymentEvent)
                .where(PaymentEvent.payment_id == payment.id)
                .order_by(PaymentEvent.created_at, PaymentEvent.id)
            )
        ).scalars().all()
    )
    assert len(events) == 2
    assert events[-1].old_status == "disputed"
    assert events[-1].new_status == "refunded"
    assert events[-1].evidence_type == "yookassa_refund"


def test_payment_dispute_route_is_registered_before_general_payments():
    path = "/api/v1/projects/{project_id}/payments/{payment_id}/dispute"
    matching = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in (getattr(route, "methods", set()) or set())
    ]
    assert len(matching) == 1
    assert matching[0].endpoint.__module__ == "app.api.v1.payment_disputes"
