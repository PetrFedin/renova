import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import EstimateLine, Payment, Project, Receipt, User, UserRole
import app.models.work_schedule  # noqa: F401
import app.models.project_documents  # noqa: F401
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.estimate_service import prepare_line
from app.services.payment_service import prepare_payment


@pytest_asyncio.fixture
async def idempotency_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db):
    customer = User(id="customer-id", phone="+79990000001", role=UserRole.customer)
    contractor = User(id="contractor-id", phone="+79990000002", role=UserRole.contractor)
    project = Project(
        id="project-id",
        name="Idempotency project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.flush()
    return customer, contractor, project


@pytest.mark.asyncio
async def test_payment_create_replays_one_entity_and_conflicts_on_changed_payload(idempotency_db):
    db = idempotency_db
    _, contractor, project = await seed_project(db)
    payload = {
        "title": "Этап 1",
        "amount": 125000.0,
        "payment_type": "stage",
        "stage_id": "stage-id",
        "notes": None,
    }
    payment = await prepare_payment(
        db,
        project.id,
        contractor.id,
        payload["title"],
        payload["amount"],
        payload["payment_type"],
        payload["stage_id"],
        payload["notes"],
    )
    created, entity_id = await commit_client_write(
        db,
        scope="payment.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="payment-request-0001",
        payload=payload,
        entity_id=payment.id,
    )
    assert created is True
    assert entity_id == payment.id

    replay_id = await replay_entity_id(
        db,
        scope="payment.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="payment-request-0001",
        payload=payload,
    )
    assert replay_id == payment.id
    assert (await db.scalar(select(func.count()).select_from(Payment))) == 1
    assert (await db.scalar(select(func.count()).select_from(ClientWriteRequest))) == 1

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await replay_entity_id(
            db,
            scope="payment.create",
            project_id=project.id,
            user_id=contractor.id,
            request_id="payment-request-0001",
            payload={**payload, "amount": 130000.0},
        )


@pytest.mark.asyncio
async def test_estimate_line_preserves_room_category_notes_and_replays(idempotency_db):
    db = idempotency_db
    _, contractor, project = await seed_project(db)
    payload = {
        "line_type": "material",
        "name": "Керамогранит",
        "unit": "m2",
        "quantity_planned": 24.5,
        "unit_price": 4200.0,
        "room_id": "room-id",
        "room_name": "Ванная",
        "category": "materials",
        "notes": "Артикул 101",
    }
    line = await prepare_line(db, project.id, payload)
    created, entity_id = await commit_client_write(
        db,
        scope="estimate_line.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="estimate-request-0001",
        payload=payload,
        entity_id=line.id,
    )
    assert created is True
    stored = await db.get(EstimateLine, entity_id)
    assert stored is not None
    assert stored.room_id == "room-id"
    assert stored.category == "materials"
    assert stored.notes == "Артикул 101"
    assert await replay_entity_id(
        db,
        scope="estimate_line.create",
        project_id=project.id,
        user_id=contractor.id,
        request_id="estimate-request-0001",
        payload=payload,
    ) == line.id
    assert (await db.scalar(select(func.count()).select_from(EstimateLine))) == 1


@pytest.mark.asyncio
async def test_manual_receipt_request_is_project_user_scoped(idempotency_db):
    db = idempotency_db
    customer, contractor, project = await seed_project(db)
    payload = {
        "amount": 1500.0,
        "description": "Доставка",
        "expense_category": "delivery",
        "room_id": None,
        "stage_id": None,
        "payment_id": None,
    }
    receipt = Receipt(
        project_id=project.id,
        amount=1500.0,
        qr_raw="Доставка",
        fn="MANUAL",
        fns_verified=True,
        expense_category="delivery",
    )
    db.add(receipt)
    await db.flush()
    created, entity_id = await commit_client_write(
        db,
        scope="receipt.manual",
        project_id=project.id,
        user_id=customer.id,
        request_id="receipt-request-0001",
        payload=payload,
        entity_id=receipt.id,
    )
    assert created is True
    assert entity_id == receipt.id
    assert await replay_entity_id(
        db,
        scope="receipt.manual",
        project_id=project.id,
        user_id=customer.id,
        request_id="receipt-request-0001",
        payload=payload,
    ) == receipt.id
    assert await replay_entity_id(
        db,
        scope="receipt.manual",
        project_id=project.id,
        user_id=contractor.id,
        request_id="receipt-request-0001",
        payload=payload,
    ) is None
    assert (await db.scalar(select(func.count()).select_from(Receipt))) == 1
