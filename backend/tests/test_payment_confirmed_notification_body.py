"""Уведомление «Перевод подтверждён» застревало и роняло чужие запросы.

Телом уведомления подставлялась `evidence.rejection_reason`. При одобрении
её нет, а колонка `app_notifications.body` объявлена NOT NULL — запись
outbox падала на вставке и оставалась необработанной. На живом стенде она
висела с пятью попытками:

    domain_outbox payment_evidence notification.created attempts=5
    asyncpg.exceptions.NotNullViolationError:
    null value in column "body" of relation "app_notifications"

Последствий два. Заказчик не узнавал, что его перевод подтверждён.
И застрявшая запись переигрывалась внутри посторонних запросов, роняя их
пятисотой — на стенде так упали создание объекта и старт этапа.
"""

import json

import pytest

from app.models.entities import Payment, PaymentStatus, Project, User, UserRole
from app.models.payment_evidence import PaymentEvidence
from app.models.entities import DomainOutbox
from app.services.client_write_side_effects import prepare_client_write_side_effects

pytestmark = pytest.mark.asyncio


async def _setup(db, suffix: str, *, status: str, reason: str | None):
    customer = User(phone=f"+7999666{suffix}", role=UserRole.customer, full_name="Заказчик")
    contractor = User(phone=f"+7999777{suffix}", role=UserRole.contractor, full_name="Исполнитель")
    db.add_all([customer, contractor])
    await db.flush()
    project = Project(
        name=f"Оплата {suffix}",
        renovation_type="capital",
        property_type="apartment",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.flush()
    payment = Payment(
        project_id=project.id,
        title="Оплата этапа: Подготовка",
        amount=9067.37,
        payment_type="stage",
        status=PaymentStatus.pending,
        created_by=contractor.id,
    )
    db.add(payment)
    await db.flush()
    evidence = PaymentEvidence(
        project_id=project.id,
        payment_id=payment.id,
        version=1,
        status=status,
        storage_key="evidence/x.pdf",
        original_filename="x.pdf",
        declared_content_type="application/pdf",
        submitted_by=customer.id,
        rejection_reason=reason,
    )
    db.add(evidence)
    await db.commit()
    return project, customer, evidence


async def _bodies(db, project, actor, evidence) -> list[str | None]:
    effects = await prepare_client_write_side_effects(
        db,
        scope="payment_evidence.review",
        project_id=project.id,
        user_id=actor.id,
        entity_id=evidence.id,
    )
    assert effects, "побочные эффекты не подготовлены"
    out = []
    for eff in effects:
        row = await db.get(DomainOutbox, eff.outbox_id)
        out.append(json.loads(row.payload_json).get("body"))
    return out


async def test_approved_evidence_gets_a_non_empty_body(db):
    project, customer, evidence = await _setup(db, "01", status="approved", reason=None)

    bodies = await _bodies(db, project, customer, evidence)

    assert bodies, "нет ни одной записи"
    for body in bodies:
        assert body, "тело уведомления пустое — вставка упадёт на NOT NULL"
    # Тело называет, за что именно подтверждён перевод.
    assert any("Оплата этапа: Подготовка" in (b or "") for b in bodies)
    assert any("9 067.37" in (b or "") or "9067.37" in (b or "") for b in bodies)


async def test_rejected_without_reason_still_has_a_body(db):
    """Отказ без причины тоже не должен ронять вставку."""
    project, customer, evidence = await _setup(db, "02", status="rejected", reason=None)

    for body in await _bodies(db, project, customer, evidence):
        assert body, "тело пустое при отказе без причины"


async def test_rejection_reason_is_preserved(db):
    project, customer, evidence = await _setup(db, "03", status="rejected", reason="Скриншот нечитаемый")

    bodies = await _bodies(db, project, customer, evidence)
    assert all(b == "Скриншот нечитаемый" for b in bodies), bodies
