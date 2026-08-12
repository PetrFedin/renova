from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    Project,
    ProjectViewer,
    Room,
    Stage,
    Team,
    TeamMember,
    User,
    UserRole,
    WorkOrder,
    WorkOrderStatus,
)
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import work_order_service


@pytest_asyncio.fixture
async def work_order_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_hybrid_project(db):
    customer = User(id="patch-customer", phone="+79990000401", role=UserRole.customer)
    contractor = User(id="patch-contractor", phone="+79990000402", role=UserRole.contractor)
    project = Project(
        id="patch-project",
        name="Patch integrity",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


async def add_work_order(db, *, project_id: str, work_order_id: str, created_by: str) -> WorkOrder:
    work_order = WorkOrder(
        id=work_order_id,
        project_id=project_id,
        title=f"Task {work_order_id}",
        work_type="painting",
        status=WorkOrderStatus.approved,
        created_by=created_by,
    )
    db.add(work_order)
    await db.commit()
    await db.refresh(work_order)
    return work_order


@pytest.mark.asyncio
async def test_stale_offline_patch_cannot_overwrite_newer_work_order_edit(work_order_db):
    customer, _, project = await seed_hybrid_project(work_order_db)
    customer_id = customer.id
    project_id = project.id
    work_order = await add_work_order(
        work_order_db,
        project_id=project_id,
        work_order_id="patch-stale-replay",
        created_by=customer_id,
    )
    stale_token = work_order.updated_at
    assert stale_token is not None

    fresh = await work_order_service.update_work_order(
        work_order_db,
        work_order,
        {"notes": "newer edit from client B"},
        expected_updated_at=stale_token,
        actor_id=customer_id,
        project=project,
    )
    assert fresh.updated_at > stale_token
    assert fresh.notes == "newer edit from client B"

    # Client A was offline with the old revision. Replaying that mutation must
    # conflict instead of winning last-write-wins over client B.
    with pytest.raises(ValueError, match="work_order_stale"):
        await work_order_service.update_work_order(
            work_order_db,
            fresh,
            {"title": "stale edit from client A"},
            expected_updated_at=stale_token,
            actor_id=customer_id,
            project=project,
        )

    assert await work_order_db.scalar(
        select(WorkOrder.title).where(WorkOrder.id == "patch-stale-replay")
    ) == "Task patch-stale-replay"
    assert await work_order_db.scalar(
        select(WorkOrder.notes).where(WorkOrder.id == "patch-stale-replay")
    ) == "newer edit from client B"


@pytest.mark.asyncio
async def test_assignment_patch_preserves_customer_and_contractor_ownership_boundaries(work_order_db):
    customer, contractor, project = await seed_hybrid_project(work_order_db)
    customer_id = customer.id
    contractor_id = contractor.id
    project_id = project.id

    viewer = User(id="patch-viewer", phone="+79990000403", role=UserRole.customer)
    member = User(id="patch-member", phone="+79990000404", role=UserRole.contractor)
    team = Team(id="patch-team", name="Contractor team", owner_id=contractor_id)
    team_member = TeamMember(
        id="patch-team-member",
        team_id=team.id,
        user_id=member.id,
        role="member",
    )
    project_viewer = ProjectViewer(
        id="patch-project-viewer",
        project_id=project_id,
        user_id=viewer.id,
    )
    work_order_db.add_all([viewer, member, team, team_member, project_viewer])
    await work_order_db.commit()

    self_managed = await add_work_order(
        work_order_db,
        project_id=project_id,
        work_order_id="patch-self-assignment",
        created_by=customer_id,
    )
    contractor_attempt = await add_work_order(
        work_order_db,
        project_id=project_id,
        work_order_id="patch-contractor-customer-assignment",
        created_by=contractor_id,
    )
    viewer_attempt = await add_work_order(
        work_order_db,
        project_id=project_id,
        work_order_id="patch-viewer-assignment",
        created_by=customer_id,
    )
    member_attempt = await add_work_order(
        work_order_db,
        project_id=project_id,
        work_order_id="patch-member-assignment",
        created_by=contractor_id,
    )

    assigned = await work_order_service.update_work_order(
        work_order_db,
        self_managed,
        {"assignee_id": customer_id},
        expected_updated_at=self_managed.updated_at,
        actor_id=customer_id,
        project=project,
    )
    assert assigned.assignee_id == customer_id

    with pytest.raises(ValueError, match="work_order_assignee_forbidden"):
        await work_order_service.update_work_order(
            work_order_db,
            contractor_attempt,
            {"assignee_id": customer_id},
            expected_updated_at=contractor_attempt.updated_at,
            actor_id=contractor_id,
            project=project,
        )

    current_project = await work_order_db.get(Project, project_id)
    current_viewer_attempt = await work_order_db.get(WorkOrder, viewer_attempt.id)
    assert current_project is not None and current_viewer_attempt is not None
    with pytest.raises(ValueError, match="work_order_assignee_invalid"):
        await work_order_service.update_work_order(
            work_order_db,
            current_viewer_attempt,
            {"assignee_id": viewer.id},
            expected_updated_at=current_viewer_attempt.updated_at,
            actor_id=customer_id,
            project=current_project,
        )

    current_project = await work_order_db.get(Project, project_id)
    current_member_attempt = await work_order_db.get(WorkOrder, member_attempt.id)
    assert current_project is not None and current_member_attempt is not None
    with pytest.raises(ValueError, match="work_order_assignee_forbidden"):
        await work_order_service.update_work_order(
            work_order_db,
            current_member_attempt,
            {"assignee_id": contractor_id},
            expected_updated_at=current_member_attempt.updated_at,
            actor_id=member.id,
            project=current_project,
        )

    assert await work_order_db.scalar(
        select(WorkOrder.assignee_id).where(WorkOrder.id == contractor_attempt.id)
    ) is None
    assert await work_order_db.scalar(
        select(WorkOrder.assignee_id).where(WorkOrder.id == viewer_attempt.id)
    ) is None
    assert await work_order_db.scalar(
        select(WorkOrder.assignee_id).where(WorkOrder.id == member_attempt.id)
    ) is None


@pytest.mark.asyncio
async def test_patch_rejects_foreign_or_archived_project_resources(work_order_db):
    customer, _, project = await seed_hybrid_project(work_order_db)
    customer_id = customer.id
    project_id = project.id
    foreign_project = Project(
        id="patch-foreign-project",
        name="Foreign project",
        renovation_type="cosmetic",
        customer_id=customer_id,
    )
    foreign_room = Room(
        id="patch-foreign-room",
        project_id=foreign_project.id,
        name="Foreign room",
        length_m=4,
        width_m=3,
    )
    archived_room = Room(
        id="patch-archived-room",
        project_id=project_id,
        name="Archived room",
        length_m=4,
        width_m=3,
        is_archived=True,
    )
    foreign_stage = Stage(
        id="patch-foreign-stage",
        project_id=foreign_project.id,
        name="Foreign stage",
    )
    work_order_db.add_all([foreign_project, foreign_room, archived_room, foreign_stage])
    await work_order_db.commit()
    work_order = await add_work_order(
        work_order_db,
        project_id=project_id,
        work_order_id="patch-resource-binding",
        created_by=customer_id,
    )

    for field, value, expected_error in (
        ("room_id", foreign_room.id, "work_order_room_invalid"),
        ("room_id", archived_room.id, "work_order_room_invalid"),
        ("stage_id", foreign_stage.id, "work_order_stage_invalid"),
    ):
        current_project = await work_order_db.get(Project, project_id)
        current = await work_order_db.get(WorkOrder, work_order.id)
        assert current_project is not None and current is not None
        with pytest.raises(ValueError, match=expected_error):
            await work_order_service.update_work_order(
                work_order_db,
                current,
                {field: value},
                expected_updated_at=current.updated_at,
                actor_id=customer_id,
                project=current_project,
            )

    assert await work_order_db.scalar(
        select(WorkOrder.room_id).where(WorkOrder.id == work_order.id)
    ) is None
    assert await work_order_db.scalar(
        select(WorkOrder.stage_id).where(WorkOrder.id == work_order.id)
    ) is None

    with pytest.raises(ValueError, match="work_order_room_invalid"):
        await work_order_service.create_work_order(
            work_order_db,
            project_id=project_id,
            user_id=customer_id,
            title="Must not bind foreign room",
            work_type="painting",
            room_id=foreign_room.id,
        )
    assert await work_order_db.scalar(
        select(WorkOrder.id).where(WorkOrder.title == "Must not bind foreign room")
    ) is None


@pytest.mark.asyncio
async def test_patch_rejects_lifecycle_dates_invalid_schedule_and_budget(work_order_db):
    customer, _, project = await seed_hybrid_project(work_order_db)
    customer_id = customer.id
    project_id = project.id
    work_order = await add_work_order(
        work_order_db,
        project_id=project_id,
        work_order_id="patch-domain-fields",
        created_by=customer_id,
    )

    invalid_patches = (
        ({"actual_start": date.today()}, "work_order_lifecycle_field_forbidden"),
        (
            {"planned_start": date(2026, 8, 20), "planned_end": date(2026, 8, 19)},
            "work_order_dates_invalid",
        ),
        ({"budget_planned": -1}, "work_order_budget_invalid"),
    )
    for patch, expected_error in invalid_patches:
        current_project = await work_order_db.get(Project, project_id)
        current = await work_order_db.get(WorkOrder, work_order.id)
        assert current_project is not None and current is not None
        with pytest.raises(ValueError, match=expected_error):
            await work_order_service.update_work_order(
                work_order_db,
                current,
                patch,
                expected_updated_at=current.updated_at,
                actor_id=customer_id,
                project=current_project,
            )

    current = await work_order_db.get(WorkOrder, work_order.id)
    assert current is not None
    assert current.actual_start is None
    assert current.planned_start is None
    assert current.planned_end is None
    assert current.budget_planned == 0
