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
