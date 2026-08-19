import pytest
import pytest_asyncio
from fastapi import HTTPException
from fastapi.routing import iter_route_contexts
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import payment_disputes
from app.api.v1.router import api_router
from app.db.base import Base
from app.models.entities import (
    DomainOutbox,
    Expense,
    Payment,
    PaymentEvent,
    PaymentStatus,
    PaymentType,
    Project,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import payment_dispute_service as disputes


@pytest_asyncio.fixture
async def resolution_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(
        id=f"resolution-customer-{suffix}",
        phone=f"+75551{suffix:0>6}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"resolution-contractor-{suffix}",
        phone=f"+76661{suffix:0>6}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"resolution-project-{suffix}",
        name=f"Resolution project {suffix}",
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
    actor_id: str,
    status: PaymentStatus,
    with_expense: bool,
):
    payment = Payment(
        id=payment_id,
        project_id=project.id,
        payment_type=PaymentType.stage,
        status=status,
        title="Оплата электромонтажа",
        amount=7000,
        created_by=actor_id,
        payment_method="bank_transfer",
    )
    db.add(payment)
    if with_expense:
        db.add(
            Expense(
                id=f"expense-{payment_id}",
                project_id=project.id,
                payment_id=payment.id,
                title=payment.title,
                category="works",
                amount=7000,
                status="confirmed",
                payment_method="bank_transfer",
            )
        )
        project.budget_spent = 7000
    await db.commit()
    return payment


@pytest.mark.asyncio
async def test_confirmed_dispute_resolution_restores_existing_expense_and_budget(resolution_db):
    customer, _, project = await seed_project(resolution_db, "101")
    payment = await seed_payment(
        resolution_db,
        payment_id="confirmed-resolution-payment",
        project=project,
        actor_id=customer.id,
        status=PaymentStatus.confirmed,
        with_expense=True,
    )
    await disputes.dispute_payment(
        resolution_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason="Качество работ требовало дополнительной проверки заказчиком",
    )
    assert (await resolution_db.get(Project, project.id)).budget_spent == 0

    note = "Недостатки устранены, результат повторно проверен и принят заказчиком"
    result = await disputes.resolve_payment_dispute(
        resolution_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        note=note,
    )
    assert result and result.changed is True and result.replayed is False
    assert result.payment.status == PaymentStatus.confirmed
    expense = (
        await resolution_db.execute(select(Expense).where(Expense.payment_id == payment.id))
    ).scalar_one()
    assert expense.status == "confirmed"
    assert (await resolution_db.get(Project, project.id)).budget_spent == 7000

    events = list(
        (
            await resolution_db.execute(
                select(PaymentEvent)
                .where(PaymentEvent.payment_id == payment.id)
                .order_by(PaymentEvent.created_at, PaymentEvent.id)
            )
        ).scalars().all()
    )
    assert len(events) == 2
    assert events[-1].old_status == "disputed"
    assert events[-1].new_status == "confirmed"
    assert events[-1].evidence_type == "customer_dispute_resolution"
    assert events[-1].evidence_ref == events[0].id
    assert events[-1].note == note
    assert (await resolution_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4

    replay = await disputes.resolve_payment_dispute(
        resolution_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        note=f"  {note}  ",
    )
    assert replay and replay.replayed is True and replay.changed is False
    assert (await resolution_db.scalar(select(func.count()).select_from(PaymentEvent))) == 2
    assert (await resolution_db.scalar(select(func.count()).select_from(DomainOutbox))) == 4

    with pytest.raises(ValueError, match="payment_dispute_already_resolved"):
        await disputes.resolve_payment_dispute(
            resolution_db,
            project_id=project.id,
            payment_id=payment.id,
            actor_user_id=customer.id,
            note="Другое пояснение не должно переписывать уже сохранённое решение",
        )
    await resolution_db.rollback()


@pytest.mark.asyncio
async def test_paid_unverified_resolution_restores_status_without_creating_expense(resolution_db):
    customer, _, project = await seed_project(resolution_db, "201")
    payment = await seed_payment(
        resolution_db,
        payment_id="unverified-resolution-payment",
        project=project,
        actor_id=customer.id,
        status=PaymentStatus.paid_unverified,
        with_expense=False,
    )
    await disputes.dispute_payment(
        resolution_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason="Перевод требовал уточнения назначения и подтверждающих документов",
    )

    result = await disputes.resolve_payment_dispute(
        resolution_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        note="Назначение перевода подтверждено, спор отозван без создания расхода",
    )
    assert result and result.payment.status == PaymentStatus.paid_unverified
    assert (await resolution_db.scalar(select(func.count()).select_from(Expense))) == 0
    assert (await resolution_db.get(Project, project.id)).budget_spent == 0


@pytest.mark.asyncio
async def test_resolution_requires_canonical_dispute_evidence(resolution_db):
    customer, _, project = await seed_project(resolution_db, "301")
    payment = await seed_payment(
        resolution_db,
        payment_id="missing-evidence-resolution-payment",
        project=project,
        actor_id=customer.id,
        status=PaymentStatus.disputed,
        with_expense=False,
    )
    project_id = project.id
    payment_id = payment.id
    customer_id = customer.id
    with pytest.raises(ValueError, match="payment_dispute_evidence_missing"):
        await disputes.resolve_payment_dispute(
            resolution_db,
            project_id=project_id,
            payment_id=payment_id,
            actor_user_id=customer_id,
            note="Клиент не может восстановить статус без исходного события спора",
        )
    await resolution_db.rollback()
    assert (await resolution_db.get(Payment, payment_id)).status == PaymentStatus.disputed


@pytest.mark.asyncio
async def test_resolution_blocks_conflicting_expense_state(resolution_db):
    customer, _, project = await seed_project(resolution_db, "401")
    payment = await seed_payment(
        resolution_db,
        payment_id="conflict-resolution-payment",
        project=project,
        actor_id=customer.id,
        status=PaymentStatus.confirmed,
        with_expense=True,
    )
    await disputes.dispute_payment(
        resolution_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason="Оплата временно оспорена для проверки финансовых документов",
    )
    expense = (
        await resolution_db.execute(select(Expense).where(Expense.payment_id == payment.id))
    ).scalar_one()
    expense.status = "refund"
    await resolution_db.commit()

    project_id = project.id
    payment_id = payment.id
    customer_id = customer.id
    with pytest.raises(ValueError, match="payment_dispute_expense_state_conflict"):
        await disputes.resolve_payment_dispute(
            resolution_db,
            project_id=project_id,
            payment_id=payment_id,
            actor_user_id=customer_id,
            note="Конфликтующий возврат нельзя заменить отзывом спора",
        )
    await resolution_db.rollback()
    assert (await resolution_db.get(Payment, payment_id)).status == PaymentStatus.disputed
    assert (await resolution_db.get(Project, project_id)).budget_spent == 0


@pytest.mark.asyncio
async def test_contractor_cannot_resolve_customer_dispute_through_api(resolution_db):
    customer, contractor, project = await seed_project(resolution_db, "501")
    payment = await seed_payment(
        resolution_db,
        payment_id="contractor-resolution-payment",
        project=project,
        actor_id=customer.id,
        status=PaymentStatus.confirmed,
        with_expense=True,
    )
    await disputes.dispute_payment(
        resolution_db,
        project_id=project.id,
        payment_id=payment.id,
        actor_user_id=customer.id,
        reason="Спор открыт заказчиком и может быть отозван только заказчиком",
    )

    with pytest.raises(HTTPException) as exc_info:
        await payment_disputes.resolve_payment_dispute(
            project_id=project.id,
            payment_id=payment.id,
            body=payment_disputes.PaymentDisputeResolutionIn(
                note="Исполнитель не может самостоятельно отозвать спор заказчика",
            ),
            user=contractor,
            db=resolution_db,
        )
    assert exc_info.value.status_code == 403
    assert (await resolution_db.get(Payment, payment.id)).status == PaymentStatus.disputed


def test_payment_dispute_resolution_route_is_canonical():
    path = "/api/v1/projects/{project_id}/payments/{payment_id}/dispute/resolve"
    matching = [
        route
        for route in iter_route_contexts(api_router.routes)
        if getattr(route, "path", None) == path
        and "POST" in (getattr(route, "methods", set()) or set())
    ]
    assert len(matching) == 1
    assert matching[0].endpoint.__module__ == "app.api.v1.payment_disputes"
