import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.router import api_router
from app.db.base import Base
from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
    Expense,
    Project,
    Room,
    Stage,
    User,
    UserRole,
)
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import expense_integrity_service as integrity
from app.services import outbox_service


@pytest_asyncio.fixture
async def expense_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_project(db, suffix: str):
    customer = User(
        id=f"expense-customer-{suffix}",
        phone=f"+72221{suffix:0>6}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"expense-project-{suffix}",
        name=f"Expense project {suffix}",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    room = Room(
        id=f"expense-room-{suffix}",
        project_id=project.id,
        name="Кухня",
        length_m=4,
        width_m=3,
    )
    stage = Stage(
        id=f"expense-stage-{suffix}",
        project_id=project.id,
        name="Отделка",
        sort_order=1,
    )
    db.add_all([customer, project, room, stage])
    await db.commit()
    return customer, project, room, stage


async def add_expense(db, *, expense_id: str, project_id: str, amount: float = 1000, **kwargs):
    expense = Expense(
        id=expense_id,
        project_id=project_id,
        title=kwargs.pop("title", "Ручной расход"),
        category=kwargs.pop("category", "other"),
        amount=amount,
        status=kwargs.pop("status", "confirmed"),
        **kwargs,
    )
    db.add(expense)
    await db.commit()
    return expense


@pytest.mark.asyncio
async def test_partial_patch_preserves_links_updates_budget_and_replays_without_audit(expense_db):
    customer, project, room, stage = await seed_project(expense_db, "101")
    expense = await add_expense(
        expense_db,
        expense_id="manual-expense-patch",
        project_id=project.id,
        amount=1000,
        room_id=room.id,
        stage_id=stage.id,
    )

    mutation = await integrity.patch_expense(
        expense_db,
        project_id=project.id,
        expense_id=expense.id,
        actor_id=customer.id,
        amount_supplied=True,
        amount=1750,
        title_supplied=False,
        title=None,
        category_supplied=False,
        category=None,
        room_id_supplied=False,
        room_id=None,
        stage_id_supplied=False,
        stage_id=None,
    )
    assert mutation and mutation.changed is True
    assert mutation.expense.amount == 1750
    assert mutation.expense.room_id == room.id
    assert mutation.expense.stage_id == stage.id
    stored_project = await expense_db.get(Project, project.id)
    assert stored_project.budget_spent == 1750
    assert (await expense_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    replay = await integrity.patch_expense(
        expense_db,
        project_id=project.id,
        expense_id=expense.id,
        actor_id=customer.id,
        amount_supplied=True,
        amount=1750,
        title_supplied=False,
        title=None,
        category_supplied=False,
        category=None,
        room_id_supplied=False,
        room_id=None,
        stage_id_supplied=False,
        stage_id=None,
    )
    assert replay and replay.replayed is True
    assert (await expense_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1
    assert await outbox_service.dispatch_pending(expense_db, worker_id="expense-patch-worker") == 1
    assert (await expense_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1


@pytest.mark.asyncio
async def test_room_and_stage_links_are_project_scoped(expense_db):
    customer, project_a, _, _ = await seed_project(expense_db, "201")
    _, project_b, room_b, stage_b = await seed_project(expense_db, "202")
    project_a_id = project_a.id
    project_b_id = project_b.id
    customer_id = customer.id
    room_b_id = room_b.id
    stage_b_id = stage_b.id
    expense_id = "scoped-expense"
    await add_expense(
        expense_db,
        expense_id=expense_id,
        project_id=project_a_id,
    )

    with pytest.raises(ValueError, match="expense_room_not_found"):
        await integrity.patch_expense(
            expense_db,
            project_id=project_a_id,
            expense_id=expense_id,
            actor_id=customer_id,
            amount_supplied=False,
            amount=None,
            title_supplied=False,
            title=None,
            category_supplied=False,
            category=None,
            room_id_supplied=True,
            room_id=room_b_id,
            stage_id_supplied=False,
            stage_id=None,
        )
    await expense_db.rollback()
    with pytest.raises(ValueError, match="expense_stage_not_found"):
        await integrity.patch_expense(
            expense_db,
            project_id=project_a_id,
            expense_id=expense_id,
            actor_id=customer_id,
            amount_supplied=False,
            amount=None,
            title_supplied=False,
            title=None,
            category_supplied=False,
            category=None,
            room_id_supplied=False,
            room_id=None,
            stage_id_supplied=True,
            stage_id=stage_b_id,
        )
    await expense_db.rollback()
    assert await integrity.get_expense(
        expense_db,
        project_id=project_b_id,
        expense_id=expense_id,
    ) is None


@pytest.mark.asyncio
async def test_bank_expense_allows_classification_but_not_source_field_tampering(expense_db):
    customer, project, room, stage = await seed_project(expense_db, "301")
    project_id = project.id
    customer_id = customer.id
    room_id = room.id
    stage_id = stage.id
    expense_id = "bank-expense"
    await add_expense(
        expense_db,
        expense_id=expense_id,
        project_id=project_id,
        amount=3200,
        title="оплата доставки",
        comment="bank_statement:v1:row-301",
        payment_method="bank_transfer",
    )

    mutation = await integrity.patch_expense(
        expense_db,
        project_id=project_id,
        expense_id=expense_id,
        actor_id=customer_id,
        amount_supplied=False,
        amount=None,
        title_supplied=False,
        title=None,
        category_supplied=True,
        category="delivery",
        room_id_supplied=True,
        room_id=room_id,
        stage_id_supplied=True,
        stage_id=stage_id,
    )
    assert mutation and mutation.changed is True
    assert mutation.expense.category == "delivery"
    assert mutation.expense.room_id == room_id
    assert mutation.expense.stage_id == stage_id

    with pytest.raises(ValueError, match="bank_expense_amount_immutable"):
        await integrity.patch_expense(
            expense_db,
            project_id=project_id,
            expense_id=expense_id,
            actor_id=customer_id,
            amount_supplied=True,
            amount=1,
            title_supplied=False,
            title=None,
            category_supplied=False,
            category=None,
            room_id_supplied=False,
            room_id=None,
            stage_id_supplied=False,
            stage_id=None,
        )
    await expense_db.rollback()
    with pytest.raises(ValueError, match="bank_expense_title_immutable"):
        await integrity.patch_expense(
            expense_db,
            project_id=project_id,
            expense_id=expense_id,
            actor_id=customer_id,
            amount_supplied=False,
            amount=None,
            title_supplied=True,
            title="Подмена операции",
            category_supplied=False,
            category=None,
            room_id_supplied=False,
            room_id=None,
            stage_id_supplied=False,
            stage_id=None,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "source"),
    [
        ("receipt_id", "receipt"),
        ("payment_id", "payment"),
        ("purchase_id", "purchase"),
        ("material_pick_id", "material_pick"),
    ],
)
async def test_source_linked_expenses_cannot_be_patched_or_deleted(expense_db, field, source):
    customer, project, _, _ = await seed_project(expense_db, f"4{len(source)}")
    project_id = project.id
    customer_id = customer.id
    expense_id = f"linked-{source}"
    await add_expense(
        expense_db,
        expense_id=expense_id,
        project_id=project_id,
        **{field: f"source-{source}"},
    )
    with pytest.raises(ValueError, match=f"expense_source_locked:{source}"):
        await integrity.patch_expense(
            expense_db,
            project_id=project_id,
            expense_id=expense_id,
            actor_id=customer_id,
            amount_supplied=True,
            amount=2000,
            title_supplied=False,
            title=None,
            category_supplied=False,
            category=None,
            room_id_supplied=False,
            room_id=None,
            stage_id_supplied=False,
            stage_id=None,
        )
    await expense_db.rollback()
    with pytest.raises(ValueError, match=f"expense_source_locked:{source}"):
        await integrity.delete_expense(
            expense_db,
            project_id=project_id,
            expense_id=expense_id,
            actor_id=customer_id,
        )


@pytest.mark.asyncio
async def test_delete_is_replay_safe_reverses_budget_and_emits_one_audit(expense_db):
    customer, project, _, _ = await seed_project(expense_db, "501")
    expense = await add_expense(
        expense_db,
        expense_id="delete-expense",
        project_id=project.id,
        amount=2400,
    )
    from app.services import budget_service

    await budget_service.refresh_budget_facts(expense_db, project.id)
    await expense_db.commit()
    stored_project = await expense_db.get(Project, project.id)
    assert stored_project.budget_spent == 2400

    deleted = await integrity.delete_expense(
        expense_db,
        project_id=project.id,
        expense_id=expense.id,
        actor_id=customer.id,
    )
    assert deleted and deleted.changed is True
    stored_project = await expense_db.get(Project, project.id)
    assert stored_project.budget_spent == 0
    assert (await expense_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1

    replay = await integrity.delete_expense(
        expense_db,
        project_id=project.id,
        expense_id=expense.id,
        actor_id=customer.id,
    )
    assert replay and replay.replayed is True
    assert (await expense_db.scalar(select(func.count()).select_from(DomainOutbox))) == 1
    assert await outbox_service.dispatch_pending(expense_db, worker_id="expense-delete-worker") == 1
    assert (await expense_db.scalar(select(func.count()).select_from(ActivityEvent))) == 1


def test_canonical_expense_routes_precede_legacy_os_routes():
    path = "/api/v1/projects/{project_id}/os/expenses/{expense_id}"
    for method in ("PATCH", "DELETE"):
        matching = [
            route
            for route in api_router.routes
            if getattr(route, "path", None) == path and method in (getattr(route, "methods", set()) or set())
        ]
        assert len(matching) >= 2
        assert matching[0].endpoint.__module__ == "app.api.v1.expense_mutations"
