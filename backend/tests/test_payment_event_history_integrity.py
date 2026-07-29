from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import payment_history
from app.api.v1.router import api_router
from app.db.base import Base
from app.models.entities import (
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
from app.services import payment_history_service as history


@pytest_asyncio.fixture
async def history_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_history(history_db):
    customer = User(id="history-customer", phone="+79990000101", role=UserRole.customer)
    contractor = User(id="history-contractor", phone="+79990000102", role=UserRole.contractor)
    project = Project(
        id="history-project",
        name="History project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    payment = Payment(
        id="history-payment",
        project_id=project.id,
        payment_type=PaymentType.stage,
        status=PaymentStatus.disputed,
        title="Оплата чистовой отделки",
        amount=15000,
        created_by=contractor.id,
    )
    untouched = Payment(
        id="history-payment-empty",
        project_id=project.id,
        payment_type=PaymentType.material,
        status=PaymentStatus.pending,
        title="Материалы",
        amount=4000,
        created_by=contractor.id,
    )
    now = datetime(2026, 7, 29, 12, 0, 0)
    receipt_old = Receipt(
        id="history-receipt-old",
        project_id=project.id,
        amount=15000,
        payment_id=payment.id,
        created_at=now,
    )
    receipt_new = Receipt(
        id="history-receipt-new",
        project_id=project.id,
        amount=15000,
        payment_id=payment.id,
        created_at=now + timedelta(minutes=1),
    )
    events = [
        PaymentEvent(
            id="event-confirmed",
            payment_id=payment.id,
            actor_user_id=customer.id,
            source="manual",
            old_status="pending",
            new_status="confirmed",
            evidence_type="receipt",
            evidence_ref=receipt_new.id,
            note="confirm_payment",
            created_at=now + timedelta(minutes=2),
        ),
        PaymentEvent(
            id="event-disputed",
            payment_id=payment.id,
            actor_user_id=customer.id,
            source="manual",
            old_status="confirmed",
            new_status="disputed",
            evidence_type="customer_dispute",
            note="Обнаружены существенные недостатки выполненных работ",
            created_at=now + timedelta(minutes=3),
        ),
        PaymentEvent(
            id="event-refund-preview",
            payment_id=payment.id,
            actor_user_id=None,
            source="webhook",
            old_status="disputed",
            new_status="refunded",
            evidence_type="yookassa_refund",
            evidence_ref="raw-provider-refund-id",
            note="refund.succeeded",
            created_at=now + timedelta(minutes=4),
        ),
    ]
    history_db.add_all([
        customer,
        contractor,
        project,
        payment,
        untouched,
        receipt_old,
        receipt_new,
        *events,
    ])
    await history_db.commit()
    return customer, project, payment, untouched


@pytest.mark.asyncio
async def test_bulk_projection_is_ordered_safe_and_actor_aware(history_db):
    customer, project, payment, untouched = await seed_history(history_db)
    event_map = await history.events_by_payment(history_db, [payment.id, untouched.id])
    receipt_map = await history.receipt_ids_by_payment(history_db, [payment.id, untouched.id])

    assert receipt_map == {payment.id: "history-receipt-new"}
    projected = event_map[payment.id]
    assert [event["id"] for event in projected] == [
        "event-confirmed",
        "event-disputed",
        "event-refund-preview",
    ]
    assert projected[0]["actor_label"] == "Заказчик"
    assert projected[0]["note"] is None
    assert projected[0]["evidence_type"] == "receipt"
    assert projected[1]["note"] == "Обнаружены существенные недостатки выполненных работ"
    assert projected[2]["actor_label"] == "ЮKassa"
    assert projected[2]["note"] is None
    assert "evidence_ref" not in projected[2]
    assert untouched.id not in event_map


@pytest.mark.asyncio
async def test_canonical_payment_list_embeds_history_without_raw_evidence(history_db):
    customer, project, payment, untouched = await seed_history(history_db)
    response = await payment_history.list_payments_with_history(
        project_id=project.id,
        user=customer,
        db=history_db,
    )
    by_id = {item.id: item for item in response}

    assert by_id[payment.id].receipt_id == "history-receipt-new"
    assert len(by_id[payment.id].events) == 3
    assert by_id[payment.id].events[1].note == "Обнаружены существенные недостатки выполненных работ"
    assert by_id[payment.id].events[2].actor_label == "ЮKassa"
    assert by_id[untouched.id].events == []


def test_canonical_payment_history_route_precedes_legacy_list():
    path = "/api/v1/projects/{project_id}/payments"
    matching = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "GET" in (getattr(route, "methods", set()) or set())
    ]
    assert len(matching) >= 2
    assert matching[0].endpoint.__module__ == "app.api.v1.payment_history"
