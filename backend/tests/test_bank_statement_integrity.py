from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

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
    Stage,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import bank_statement_integrity as integrity
from app.services import outbox_service


@pytest_asyncio.fixture
async def bank_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(
        id=f"bank-customer-{suffix}",
        phone=f"+74441{suffix:0>6}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"bank-contractor-{suffix}",
        phone=f"+73331{suffix:0>6}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"bank-project-{suffix}",
        name=f"Bank project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


def sample_rows():
    return [
        {"date": "2026-07-01", "amount": 1500.0, "description": "Доставка материалов"},
        {"date": "2026-07-01", "amount": 1500.0, "description": "Доставка   материалов"},
    ]


def test_statement_row_identity_is_stable_and_preserves_duplicate_ordinals():
    first = integrity.annotate_statement_rows(sample_rows())
    second = integrity.annotate_statement_rows(sample_rows())
    assert first[0]["bank_row_id"] == second[0]["bank_row_id"]
    assert first[1]["bank_row_id"] == second[1]["bank_row_id"]
    assert first[0]["bank_row_id"] != first[1]["bank_row_id"]
    assert [row["bank_row_ordinal"] for row in first] == [0, 1]


def test_match_token_is_scoped_signed_and_subset_authorized():
    rows = integrity.annotate_statement_rows(sample_rows())
    matches = [
        {
            "row": rows[0],
            "payment_id": "payment-a",
            "payment_amount": 1500.0,
        },
        {
            "row": rows[1],
            "payment_id": "payment-b",
            "payment_amount": 1500.0,
        },
    ]
    token = integrity.create_match_token(
        project_id="project-a",
        user_id="customer-a",
        matches=matches,
    )
    assert token
    claims = integrity.verify_match_token(
        token,
        project_id="project-a",
        user_id="customer-a",
        payment_ids=["payment-b"],
    )
    assert [(claim.payment_id, claim.row_id, claim.amount) for claim in claims] == [
        ("payment-b", rows[1]["bank_row_id"], 1500.0)
    ]
    with pytest.raises(ValueError, match="bank_match_not_authorized"):
        integrity.verify_match_token(
            token,
            project_id="project-a",
            user_id="customer-a",
            payment_ids=["payment-x"],
        )
    with pytest.raises(ValueError, match="bank_match_token_scope_mismatch"):
        integrity.verify_match_token(
            token,
            project_id="project-b",
            user_id="customer-a",
            payment_ids=["payment-a"],
        )
    with pytest.raises(ValueError, match="bank_match_token_invalid"):
        integrity.verify_match_token(
            token[:-1] + ("0" if token[-1] != "0" else "1"),
            project_id="project-a",
            user_id="customer-a",
            payment_ids=["payment-a"],
        )


@pytest.mark.asyncio
async def test_unmatched_expenses_are_idempotent_and_budget_is_exact(bank_db):
    customer, _, project = await seed_project(bank_db, "101")
    rows = integrity.annotate_statement_rows(sample_rows())

    first = await integrity.create_expenses_from_rows(
        bank_db,
        project_id=project.id,
        actor_id=customer.id,
        rows=rows,
    )
    assert first["expenses_created"] == 2
    assert first["expenses_replayed"] == 0
    assert (await bank_db.scalar(select(func.count()).select_from(Expense))) == 2
    stored_project = await bank_db.get(Project, project.id)
    assert stored_project.budget_spent == 3000
    assert (await bank_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    second = await integrity.create_expenses_from_rows(
        bank_db,
        project_id=project.id,
        actor_id=customer.id,
        rows=rows,
    )
    assert second["expenses_created"] == 0
    assert second["expenses_replayed"] == 2
    assert (await bank_db.scalar(select(func.count()).select_from(Expense))) == 2
    stored_project = await bank_db.get(Project, project.id)
    assert stored_project.budget_spent == 3000
    assert (await bank_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    assert await outbox_service.dispatch_pending(bank_db, worker_id="bank-expense-worker") == 1
    assert (await bank_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1


@pytest.mark.asyncio
async def test_confirm_match_is_atomic_evidenced_and_replay_safe(bank_db):
    customer, contractor, project = await seed_project(bank_db, "201")
    stage = Stage(
        id="bank-stage-accepted",
        project_id=project.id,
        name="Отделка",
        sort_order=1,
        payment_amount=5000,
        customer_accepted_at=datetime(2026, 7, 1, 12, 0),
    )
    payment = Payment(
        id="bank-payment-confirm",
        project_id=project.id,
        stage_id=stage.id,
        payment_type=PaymentType.stage,
        status=PaymentStatus.pending,
        title="Оплата отделки",
        amount=5000,
        created_by=contractor.id,
    )
    bank_db.add_all([stage, payment])
    await bank_db.commit()
    claim = integrity.MatchClaim(payment_id=payment.id, row_id="row-confirm-1", amount=5000)

    result = await integrity.confirm_matches(
        bank_db,
        project=project,
        actor_id=customer.id,
        claims=[claim],
    )
    assert result.confirmed == [payment.id]
    assert result.replayed == []
    assert result.blocked == []
    stored_payment = await bank_db.get(Payment, payment.id)
    assert stored_payment.status == PaymentStatus.confirmed
    assert stored_payment.payment_method == "bank_transfer"
    event = (
        await bank_db.execute(select(PaymentEvent).where(PaymentEvent.payment_id == payment.id))
    ).scalar_one()
    assert event.source == "bank_import"
    assert event.evidence_type == "bank_statement"
    assert event.evidence_ref == "row-confirm-1"
    expense = (
        await bank_db.execute(select(Expense).where(Expense.payment_id == payment.id))
    ).scalar_one()
    assert expense.amount == 5000
    stored_project = await bank_db.get(Project, project.id)
    assert stored_project.budget_spent == 5000
    assert (await bank_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    replay = await integrity.confirm_matches(
        bank_db,
        project=project,
        actor_id=customer.id,
        claims=[claim],
    )
    assert replay.confirmed == []
    assert replay.replayed == [payment.id]
    assert (await bank_db.scalar(select(func.count()).select_from(PaymentEvent))) == 1
    assert (await bank_db.scalar(select(func.count()).select_from(Expense))) == 1
    assert (await bank_db.scalar(select(func.count()).select_from(DomainOutbox))) == 2

    assert await outbox_service.dispatch_pending(bank_db, worker_id="bank-confirm-worker") == 2
    assert (await bank_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1
    assert (await bank_db.scalar(select(func.count()).select_from(AppNotification))) == 1


@pytest.mark.asyncio
async def test_unaccepted_stage_and_wrong_amount_are_blocked_without_side_effects(bank_db):
    customer, contractor, project = await seed_project(bank_db, "301")
    stage = Stage(
        id="bank-stage-blocked",
        project_id=project.id,
        name="Черновые работы",
        sort_order=1,
        payment_amount=7000,
    )
    payment = Payment(
        id="bank-payment-blocked",
        project_id=project.id,
        stage_id=stage.id,
        payment_type=PaymentType.stage,
        status=PaymentStatus.pending,
        title="Оплата черновых работ",
        amount=7000,
        created_by=contractor.id,
    )
    bank_db.add_all([stage, payment])
    await bank_db.commit()

    blocked = await integrity.confirm_matches(
        bank_db,
        project=project,
        actor_id=customer.id,
        claims=[integrity.MatchClaim(payment_id=payment.id, row_id="row-blocked", amount=7000)],
    )
    assert blocked.blocked == [payment.id]

    wrong_amount = await integrity.confirm_matches(
        bank_db,
        project=project,
        actor_id=customer.id,
        claims=[integrity.MatchClaim(payment_id=payment.id, row_id="row-wrong", amount=1)],
    )
    assert wrong_amount.blocked == [payment.id]
    stored = await bank_db.get(Payment, payment.id)
    assert stored.status == PaymentStatus.pending
    assert (await bank_db.scalar(select(func.count()).select_from(PaymentEvent))) == 0
    assert (await bank_db.scalar(select(func.count()).select_from(Expense))) == 0
    assert (await bank_db.scalar(select(func.count()).select_from(DomainOutbox))) == 0


def test_bank_statement_routes_are_single_and_canonical():
    paths = {
        "/api/v1/projects/{project_id}/import/bank-statement",
        "/api/v1/projects/{project_id}/import/bank-statement/confirm",
    }
    for path in paths:
        matching = [
            route
            for route in api_router.routes
            if getattr(route, "path", None) == path and "POST" in (getattr(route, "methods", set()) or set())
        ]
        assert len(matching) == 1
        assert matching[0].endpoint.__module__ == "app.api.v1.bank_statements"
