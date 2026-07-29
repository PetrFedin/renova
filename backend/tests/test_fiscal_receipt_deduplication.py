import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Expense, Project, Receipt, User, UserRole
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import budget_service
from app.services.client_write_idempotency import IdempotencyConflict, commit_client_write
from app.services.client_write_side_effects import clear_request_side_effect_context


@pytest_asyncio.fixture
async def fiscal_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    user = User(
        id=f"fiscal-user-{suffix}",
        phone=f"+74441{suffix:0>6}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"fiscal-project-{suffix}",
        name=f"Fiscal {suffix}",
        renovation_type="cosmetic",
        customer_id=user.id,
    )
    db.add_all([user, project])
    await db.commit()
    return user.id, project.id


async def prepare_scan_candidate(
    db,
    *,
    receipt_id: str,
    project_id: str,
    amount: float,
    fn: str | None,
    fd: str | None,
    qr_raw: str,
):
    receipt = Receipt(
        id=receipt_id,
        project_id=project_id,
        amount=amount,
        qr_raw=qr_raw,
        fn=fn,
        fd=fd,
        fns_verified=True,
        verification_status="verified_live",
        expense_category="materials",
    )
    db.add(receipt)
    await db.flush()
    await budget_service.expense_from_receipt(db, receipt)
    await budget_service.refresh_budget_facts(db, project_id)
    return receipt


def payload(qr_raw: str):
    return {
        "qr_raw": qr_raw,
        "expense_category": "materials",
        "room_id": None,
        "stage_id": None,
        "payment_id": None,
    }


@pytest.mark.asyncio
async def test_second_request_maps_to_canonical_receipt_without_duplicate_fact(fiscal_db):
    user_id, project_id = await seed_project(fiscal_db, "101")
    qr_raw = "t=20260729T1200&s=3200.00&fn=9001&fd=7001&fp=1&n=1"
    first = await prepare_scan_candidate(
        fiscal_db,
        receipt_id="fiscal-canonical",
        project_id=project_id,
        amount=3200,
        fn="9001",
        fd="7001",
        qr_raw=qr_raw,
    )
    created, first_id = await commit_client_write(
        fiscal_db,
        scope="receipt.scan",
        project_id=project_id,
        user_id=user_id,
        request_id="fiscal-request-first",
        payload=payload(qr_raw),
        entity_id=first.id,
    )
    assert created is True
    assert first_id == first.id
    clear_request_side_effect_context()

    second = await prepare_scan_candidate(
        fiscal_db,
        receipt_id="fiscal-duplicate",
        project_id=project_id,
        amount=3200,
        fn="9001",
        fd="7001",
        qr_raw=qr_raw,
    )
    created, canonical_id = await commit_client_write(
        fiscal_db,
        scope="receipt.scan",
        project_id=project_id,
        user_id=user_id,
        request_id="fiscal-request-second",
        payload=payload(qr_raw),
        entity_id=second.id,
    )
    assert created is False
    assert canonical_id == first.id
    assert (await fiscal_db.scalar(select(func.count()).select_from(Receipt))) == 1
    assert (await fiscal_db.scalar(select(func.count()).select_from(Expense))) == 1
    assert (await fiscal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1
    assert (await fiscal_db.scalar(select(func.count()).select_from(ClientWriteRequest))) == 2
    project = await fiscal_db.get(Project, project_id)
    assert project.budget_spent == 3200
    ledgers = list(
        (
            await fiscal_db.execute(
                select(ClientWriteRequest).order_by(ClientWriteRequest.request_id)
            )
        ).scalars().all()
    )
    assert {row.entity_id for row in ledgers} == {first.id}


@pytest.mark.asyncio
async def test_duplicate_without_request_id_is_still_collapsed(fiscal_db):
    user_id, project_id = await seed_project(fiscal_db, "201")
    qr_raw = "raw-fiscal-payload-without-fn-fd"
    first = await prepare_scan_candidate(
        fiscal_db,
        receipt_id="raw-canonical",
        project_id=project_id,
        amount=800,
        fn=None,
        fd=None,
        qr_raw=qr_raw,
    )
    created, canonical_id = await commit_client_write(
        fiscal_db,
        scope="receipt.scan",
        project_id=project_id,
        user_id=user_id,
        request_id=None,
        payload=payload(qr_raw),
        entity_id=first.id,
    )
    assert created is True and canonical_id == first.id
    clear_request_side_effect_context()

    duplicate = await prepare_scan_candidate(
        fiscal_db,
        receipt_id="raw-duplicate",
        project_id=project_id,
        amount=800,
        fn=None,
        fd=None,
        qr_raw=qr_raw,
    )
    created, canonical_id = await commit_client_write(
        fiscal_db,
        scope="receipt.scan",
        project_id=project_id,
        user_id=user_id,
        request_id=None,
        payload=payload(qr_raw),
        entity_id=duplicate.id,
    )
    assert created is False and canonical_id == first.id
    assert (await fiscal_db.scalar(select(func.count()).select_from(Receipt))) == 1
    assert (await fiscal_db.scalar(select(func.count()).select_from(Expense))) == 1
    assert (await fiscal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1


@pytest.mark.asyncio
async def test_same_fiscal_identity_is_allowed_in_another_project(fiscal_db):
    user_a, project_a = await seed_project(fiscal_db, "301")
    user_b, project_b = await seed_project(fiscal_db, "302")
    qr_raw = "t=20260729T1200&s=1000.00&fn=shared&fd=shared&fp=1&n=1"
    for suffix, user_id, project_id in [
        ("a", user_a, project_a),
        ("b", user_b, project_b),
    ]:
        receipt = await prepare_scan_candidate(
            fiscal_db,
            receipt_id=f"shared-{suffix}",
            project_id=project_id,
            amount=1000,
            fn="shared",
            fd="shared",
            qr_raw=qr_raw,
        )
        created, entity_id = await commit_client_write(
            fiscal_db,
            scope="receipt.scan",
            project_id=project_id,
            user_id=user_id,
            request_id=f"shared-request-{suffix}",
            payload=payload(qr_raw),
            entity_id=receipt.id,
        )
        assert created is True and entity_id == receipt.id
        clear_request_side_effect_context()
    assert (await fiscal_db.scalar(select(func.count()).select_from(Receipt))) == 2
    assert (await fiscal_db.scalar(select(func.count()).select_from(Expense))) == 2


@pytest.mark.asyncio
async def test_same_fn_fd_with_different_amount_is_blocked(fiscal_db):
    user_id, project_id = await seed_project(fiscal_db, "401")
    qr_raw = "t=20260729T1200&s=1000.00&fn=conflict&fd=conflict&fp=1&n=1"
    first = await prepare_scan_candidate(
        fiscal_db,
        receipt_id="conflict-canonical",
        project_id=project_id,
        amount=1000,
        fn="conflict",
        fd="conflict",
        qr_raw=qr_raw,
    )
    await commit_client_write(
        fiscal_db,
        scope="receipt.scan",
        project_id=project_id,
        user_id=user_id,
        request_id="conflict-first",
        payload=payload(qr_raw),
        entity_id=first.id,
    )
    clear_request_side_effect_context()

    conflicting = await prepare_scan_candidate(
        fiscal_db,
        receipt_id="conflict-second",
        project_id=project_id,
        amount=1400,
        fn="conflict",
        fd="conflict",
        qr_raw=qr_raw.replace("1000.00", "1400.00"),
    )
    with pytest.raises(IdempotencyConflict, match="fiscal_receipt_identity_conflict"):
        await commit_client_write(
            fiscal_db,
            scope="receipt.scan",
            project_id=project_id,
            user_id=user_id,
            request_id="conflict-second",
            payload=payload(qr_raw.replace("1000.00", "1400.00")),
            entity_id=conflicting.id,
        )
    await fiscal_db.rollback()
    assert (await fiscal_db.scalar(select(func.count()).select_from(Receipt))) == 1
    assert (await fiscal_db.scalar(select(func.count()).select_from(Expense))) == 1
    assert (await fiscal_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1
