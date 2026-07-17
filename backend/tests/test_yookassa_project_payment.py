"""P1.1: ЮKassa checkout + webhook for project payments."""
import pytest

from app.models.entities import Payment, PaymentStatus, PaymentType, Project, Stage, User, UserRole
from app.services import payment_service as pay_svc
from app.services import yookassa_service as yk


@pytest.mark.asyncio
async def test_yookassa_demo_allowed_in_development(monkeypatch):
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "yookassa_shop_id", None)
    monkeypatch.setattr(cfg.settings, "yookassa_secret", None)
    monkeypatch.setattr(cfg.settings, "environment", "development")
    assert yk.demo_allowed() is True
    pay = await yk.create_payment(100.0, "test", "renova://return", metadata={"kind": "project_payment"})
    assert pay.get("demo") is True


@pytest.mark.asyncio
async def test_yookassa_not_configured_staging(monkeypatch):
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "yookassa_shop_id", None)
    monkeypatch.setattr(cfg.settings, "environment", "staging")
    pay = await yk.create_payment(100.0, "test", "renova://return")
    assert pay.get("error") == "yookassa_not_configured"


@pytest.mark.asyncio
async def test_webhook_confirms_project_payment(db, monkeypatch):
    from app.core import config as cfg
    from datetime import datetime

    monkeypatch.setattr(cfg.settings, "environment", "development")

    customer = User(id="cust1", phone="+70000000001", role=UserRole.customer)
    contractor = User(id="contr1", phone="+70000000002", role=UserRole.contractor)
    db.add_all([customer, contractor])
    project = Project(
        id="proj1",
        name="Test",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100000,
        budget_spent=0,
    )
    stage = Stage(
        id="st1",
        project_id=project.id,
        name="Этап 1",
        sort_order=1,
        customer_accepted_at=datetime.utcnow(),
    )
    db.add_all([project, stage])
    await db.commit()

    payment = await pay_svc.create_payment(
        db, project.id, contractor.id, "Оплата этапа", 5000.0, PaymentType.stage.value, stage.id
    )

    body = {
        "event": "payment.succeeded",
        "object": {
            "id": "yk-test-123",
            "status": "succeeded",
            "metadata": {
                "kind": "project_payment",
                "payment_id": payment.id,
                "project_id": project.id,
                "user_id": customer.id,
            },
        },
    }
    result = await yk.process_webhook(body, db)
    assert result.get("confirmed") is True

    refreshed = await pay_svc.get_payment(db, payment.id)
    assert refreshed.status == PaymentStatus.confirmed
    assert refreshed.yookassa_payment_id == "yk-test-123"
