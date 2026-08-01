import pytest

from app.models.entities import Payment, PaymentStatus, PaymentType, Project, Stage, StageStatus
from app.services import payment_service


class FakeSession:
    """Small SQLAlchemy-session double that applies Payment UPDATE values."""

    def __init__(self, *, payment: Payment, project: Project | None = None, stage: Stage | None = None):
        self.payment = payment
        self.project = project
        self.stage = stage
        self.commits = 0
        self.rollbacks = 0
        self.added: list[object] = []

    async def get(self, model, object_id):
        if model is Payment and object_id == self.payment.id:
            return self.payment
        if model is Project and self.project and object_id == self.project.id:
            return self.project
        if model is Stage and self.stage and object_id == self.stage.id:
            return self.stage
        return None

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    async def rollback(self):
        self.rollbacks += 1

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        return None

    async def execute(self, statement):
        values = getattr(statement, "_values", None) or {}
        if values:
            for column, expression in values.items():
                name = getattr(column, "key", None) or str(column).rsplit(".", 1)[-1]
                value = getattr(expression, "value", expression)
                if name in {"status", "payment_method", "confirmed_at"}:
                    setattr(self.payment, name, value)

        class _Scalars:
            @staticmethod
            def all():
                return []

            @staticmethod
            def first():
                return None

        class _Result:
            rowcount = 1

            @staticmethod
            def scalar_one_or_none():
                return None

            @staticmethod
            def scalars():
                return _Scalars()

            @staticmethod
            def first():
                return None

        return _Result()


async def _noop_expense(_db, _payment):
    return None


async def _noop_refresh(_db, _project_id):
    return None


async def _no_side_effects(_db, **_kwargs):
    return []


def isolate_payment_side_effects(monkeypatch):
    monkeypatch.setattr("app.services.budget_service.expense_from_payment", _noop_expense)
    monkeypatch.setattr("app.services.budget_service.refresh_budget_facts", _noop_refresh)
    monkeypatch.setattr(payment_service, "_prepare_transition_side_effects", _no_side_effects)


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
    isolate_payment_side_effects(monkeypatch)
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

    confirmed = await payment_service.confirm_payment(
        session,
        payment.id,
        project_id="project-a",
        transfer_ack=True,
    )
    assert confirmed is not None
    assert confirmed.status == PaymentStatus.paid_unverified
    assert confirmed.confirmed_at is None
    assert session.commits == 1
    assert session.added


@pytest.mark.asyncio
async def test_yookassa_id_alone_is_not_settlement_proof(monkeypatch):
    """Checkout attach must not unlock manual confirm without webhook/ack/receipt."""
    isolate_payment_side_effects(monkeypatch)
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
        session,
        payment.id,
        project_id="project-a",
        allow_without_settlement=True,
    )
    assert via_webhook is not None
    assert via_webhook.status == PaymentStatus.confirmed
    assert via_webhook.payment_method == "yookassa"
    assert via_webhook.confirmed_at is not None
    assert session.commits == 1
    assert session.added
