import pytest

from app.models.entities import Payment, PaymentStatus, PaymentType, Project, Stage, StageStatus
from app.services import payment_service


class FakeSession:
    def __init__(self, *, payment: Payment, project: Project | None = None, stage: Stage | None = None):
        self.payment = payment
        self.project = project
        self.stage = stage
        self.commits = 0

    async def get(self, model, object_id):
        if model is Payment and object_id == self.payment.id:
            return self.payment
        if model is Project and self.project and object_id == self.project.id:
            return self.project
        if model is Stage and self.stage and object_id == self.stage.id:
            return self.stage
        return None

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        return None

    async def execute(self, _stmt):
        class _Result:
            def scalar_one_or_none(self):
                return None
        return _Result()


@pytest.mark.asyncio
async def test_confirm_payment_rejects_foreign_project_before_mutation():
    payment = Payment(
        id="payment-1",
        project_id="project-a",
        payment_type=PaymentType.advance,
        title="Аванс",
        amount=1000,
        status=PaymentStatus.pending,
        created_by="user-1",
    )
    session = FakeSession(payment=payment)

    result = await payment_service.confirm_payment(session, payment.id, project_id="project-b")

    assert result is None
    assert payment.status == PaymentStatus.pending
    assert payment.confirmed_at is None
    assert session.commits == 0


@pytest.mark.asyncio
async def test_confirm_stage_payment_requires_customer_acceptance():
    payment = Payment(
        id="payment-2",
        project_id="project-a",
        stage_id="stage-1",
        payment_type=PaymentType.stage,
        title="Оплата этапа",
        amount=2000,
        status=PaymentStatus.pending,
        created_by="contractor-1",
    )
    stage = Stage(
        id="stage-1",
        project_id="project-a",
        name="Черновые работы",
        status=StageStatus.review,
        customer_accepted_at=None,
    )
    session = FakeSession(payment=payment, stage=stage)

    result = await payment_service.confirm_payment(session, payment.id, project_id="project-a")

    assert result is None
    assert payment.status == PaymentStatus.pending
    assert payment.confirmed_at is None
    assert session.commits == 0


@pytest.mark.asyncio
async def test_confirm_requires_settlement_proof(monkeypatch):
    """Manual confirm without receipt/ack/YuKassa must not succeed."""
    async def _noop_expense(_db, _payment):
        return None

    monkeypatch.setattr("app.services.budget_service.expense_from_payment", _noop_expense)
    payment = Payment(
        id="payment-3",
        project_id="project-a",
        stage_id=None,
        payment_type=PaymentType.material,
        title="Материалы",
        amount=1000,
        status=PaymentStatus.pending,
        created_by="contractor-1",
    )
    project = Project(id="project-a", name="P", customer_id="c1", renovation_type="capital", budget_spent=0.0)
    session = FakeSession(payment=payment, project=project)
    blocked = await payment_service.confirm_payment(session, payment.id, project_id="project-a")
    assert blocked is None
    ok = await payment_service.confirm_payment(
        session, payment.id, project_id="project-a", transfer_ack=True
    )
    assert ok is not None
    assert ok.status == PaymentStatus.confirmed


@pytest.mark.asyncio
async def test_yookassa_id_alone_is_not_settlement_proof(monkeypatch):
    """Checkout attach must not unlock manual confirm without webhook/ack/receipt."""
    async def _noop_expense(_db, _payment):
        return None

    monkeypatch.setattr("app.services.budget_service.expense_from_payment", _noop_expense)
    payment = Payment(
        id="payment-4",
        project_id="project-a",
        payment_type=PaymentType.advance,
        title="Аванс",
        amount=500,
        status=PaymentStatus.pending,
        created_by="user-1",
        yookassa_payment_id="yk-checkout-started",
    )
    session = FakeSession(payment=payment)
    blocked = await payment_service.confirm_payment(session, payment.id, project_id="project-a")
    assert blocked is None
    via_webhook = await payment_service.confirm_payment(
        session, payment.id, project_id="project-a", allow_without_settlement=True
    )
    assert via_webhook is not None
