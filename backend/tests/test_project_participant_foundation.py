from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.entities import Project, Room, Stage, User, UserRole
from app.models.project_participants import ProjectParticipantEvent
from app.services import project_participant_service as participant_service
from app.services import team_service


async def _seed(db, suffix: str = "a"):
    phone_token = sum((idx + 1) * ord(ch) for idx, ch in enumerate(suffix)) % 10000
    customer = User(
        id=f"pp-customer-{suffix}",
        phone=f"+7900{phone_token:04d}001",
        role=UserRole.customer,
    )
    lead = User(
        id=f"pp-lead-{suffix}",
        phone=f"+7900{phone_token:04d}002",
        role=UserRole.contractor,
    )
    electrician = User(
        id=f"pp-electric-{suffix}",
        phone=f"+7900{phone_token:04d}003",
        role=UserRole.contractor,
    )
    plumber = User(
        id=f"pp-plumber-{suffix}",
        phone=f"+7900{phone_token:04d}004",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"pp-project-{suffix}",
        name="Multi contractor foundation",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=lead.id,
    )
    room_a = Room(
        id=f"pp-room-a-{suffix}",
        project_id=project.id,
        name="Кухня",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=1,
    )
    room_b = Room(
        id=f"pp-room-b-{suffix}",
        project_id=project.id,
        name="Ванная",
        length_m=3,
        width_m=2,
        height_m=2.7,
        openings_sq_m=1,
    )
    stage_a = Stage(
        id=f"pp-stage-a-{suffix}",
        project_id=project.id,
        name="Электрика",
        sort_order=0,
        work_type="electrical",
        room_ids_json=f'["{room_a.id}"]',
    )
    stage_b = Stage(
        id=f"pp-stage-b-{suffix}",
        project_id=project.id,
        name="Сантехника",
        sort_order=1,
        work_type="plumbing",
        room_ids_json=f'["{room_b.id}"]',
    )
    db.add_all([customer, lead, electrician, plumber, project, room_a, room_b, stage_a, stage_b])
    await db.commit()
    return customer, lead, electrician, plumber, project, room_a, room_b, stage_a, stage_b


@pytest.mark.asyncio
async def test_independent_participant_is_scoped_but_generic_project_acl_stays_closed(db):
    customer, _, electrician, _, project, _, _, stage_a, stage_b = await _seed(db, "acl")

    participant, created = await participant_service.add_or_reactivate_contractor(
        db,
        project_id=project.id,
        actor_id=customer.id,
        contractor_id=electrician.id,
        scopes=[("stage", stage_a.id)],
    )

    assert created is True
    assert participant.participant_role == "contractor"
    assert participant.all_scope is False
    assert await participant_service.scope_allows(
        db, project=project, user_id=electrician.id, stage_id=stage_a.id
    ) is True
    assert await participant_service.scope_allows(
        db, project=project, user_id=electrician.id, stage_id=stage_b.id
    ) is False
    assert await participant_service.scope_allows(
        db, project=project, user_id=electrician.id
    ) is False
    # Foundation invariant: introducing the participant table must not silently
    # turn generic project reads/writes into broad access before each domain is
    # converted to scope-aware filtering.
    assert await team_service.can_access_project(db, electrician, project, write=False) is False
    assert await team_service.can_access_project(db, electrician, project, write=True) is False


@pytest.mark.asyncio
async def test_stage_assignee_eligibility_respects_stage_room_and_work_type_scope(db):
    customer, lead, electrician, plumber, project, room_a, _, stage_a, stage_b = await _seed(db, "scope")
    assert await participant_service.stage_assignee_allowed(
        db, project=project, stage=stage_b, user_id=lead.id
    ) is True

    await participant_service.add_or_reactivate_contractor(
        db,
        project_id=project.id,
        actor_id=customer.id,
        contractor_id=electrician.id,
        scopes=[("room", room_a.id)],
    )
    assert await participant_service.stage_assignee_allowed(
        db, project=project, stage=stage_a, user_id=electrician.id
    ) is True
    assert await participant_service.stage_assignee_allowed(
        db, project=project, stage=stage_b, user_id=electrician.id
    ) is False

    await participant_service.add_or_reactivate_contractor(
        db,
        project_id=project.id,
        actor_id=customer.id,
        contractor_id=plumber.id,
        scopes=[("work_type", "plumbing")],
    )
    assert await participant_service.stage_assignee_allowed(
        db, project=project, stage=stage_b, user_id=plumber.id
    ) is True
    assert await participant_service.stage_assignee_allowed(
        db, project=project, stage=stage_a, user_id=plumber.id
    ) is False


@pytest.mark.asyncio
async def test_cross_project_scope_is_rejected_fail_closed(db):
    customer, _, electrician, _, project, _, _, _, _ = await _seed(db, "cross-a")
    other_customer, _, _, _, other_project, _, _, other_stage, _ = await _seed(db, "cross-b")
    assert other_customer.id != customer.id
    assert other_project.id != project.id

    with pytest.raises(ValueError, match="participant_stage_scope_cross_project"):
        await participant_service.add_or_reactivate_contractor(
            db,
            project_id=project.id,
            actor_id=customer.id,
            contractor_id=electrician.id,
            scopes=[("stage", other_stage.id)],
        )
    await db.rollback()


@pytest.mark.asyncio
async def test_remove_preserves_history_and_revokes_scope(db):
    customer, _, electrician, _, project, _, _, stage_a, _ = await _seed(db, "remove")
    participant, _ = await participant_service.add_or_reactivate_contractor(
        db,
        project_id=project.id,
        actor_id=customer.id,
        contractor_id=electrician.id,
        scopes=[("stage", stage_a.id)],
    )
    removed = await participant_service.remove_contractor(
        db,
        project_id=project.id,
        participant_id=participant.id,
        actor_id=customer.id,
    )
    assert removed.status == "removed"
    assert removed.removed_by == customer.id
    assert await participant_service.scope_allows(
        db, project=project, user_id=electrician.id, stage_id=stage_a.id
    ) is False
    event_types = list(
        (
            await db.execute(
                select(ProjectParticipantEvent.event_type)
                .where(ProjectParticipantEvent.participant_id == participant.id)
                .order_by(ProjectParticipantEvent.created_at.asc(), ProjectParticipantEvent.id.asc())
            )
        ).scalars().all()
    )
    assert len(event_types) == 2
    assert set(event_types) == {"added", "removed"}


@pytest.mark.asyncio
async def test_customer_only_mutation_and_legacy_lead_cannot_be_duplicated(db):
    customer, lead, electrician, _, project, _, _, stage_a, _ = await _seed(db, "owner")
    project_id = project.id
    customer_id = customer.id
    lead_id = lead.id
    electrician_id = electrician.id
    stage_id = stage_a.id

    with pytest.raises(ValueError, match="participant_customer_owner_only"):
        await participant_service.add_or_reactivate_contractor(
            db,
            project_id=project_id,
            actor_id=electrician_id,
            contractor_id=electrician_id,
            scopes=[("stage", stage_id)],
        )
    await db.rollback()

    with pytest.raises(ValueError, match="participant_is_legacy_lead"):
        await participant_service.add_or_reactivate_contractor(
            db,
            project_id=project_id,
            actor_id=customer_id,
            contractor_id=lead_id,
            scopes=[("stage", stage_id)],
        )
    await db.rollback()

    assert int(
        await db.scalar(select(func.count()).select_from(ProjectParticipantEvent)) or 0
    ) == 0
