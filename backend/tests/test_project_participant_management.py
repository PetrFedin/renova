from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.routing import iter_route_contexts
from sqlalchemy import func, select

from app.api.v1 import project_participants as participant_api
from app.main import app
from app.models.entities import Project, Room, Stage, User, UserRole
from app.models.project_participants import (
    ProjectParticipant,
    ProjectParticipantEvent,
    ProjectParticipantScope,
)
from app.services import project_create_service
from app.services import project_participant_service as participant_service
from app.services import team_service


async def _seed(db, suffix: str = "mgmt"):
    customer = User(
        id=f"mgmt-customer-{suffix}",
        phone=f"+7888{sum(map(ord, suffix)) % 100000:05d}01",
        role=UserRole.customer,
        full_name="Заказчик",
    )
    lead = User(
        id=f"mgmt-lead-{suffix}",
        phone=f"+7888{sum(map(ord, suffix)) % 100000:05d}02",
        role=UserRole.contractor,
        full_name="Генподрядчик",
    )
    first = User(
        id=f"mgmt-first-{suffix}",
        phone=f"+7888{sum(map(ord, suffix)) % 100000:05d}03",
        role=UserRole.contractor,
        full_name="Электрик",
    )
    second = User(
        id=f"mgmt-second-{suffix}",
        phone=f"+7888{sum(map(ord, suffix)) % 100000:05d}04",
        role=UserRole.contractor,
        full_name="Сантехник",
    )
    project = Project(
        id=f"mgmt-project-{suffix}",
        name="Participant management",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add_all([customer, lead, first, second, project])
    await db.flush()
    room = Room(
        id=f"mgmt-room-{suffix}",
        project_id=project.id,
        name="Кухня",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=1,
    )
    stage = Stage(
        id=f"mgmt-stage-{suffix}",
        project_id=project.id,
        name="Электрика",
        sort_order=0,
        work_type="electrical",
        room_ids_json=f'["{room.id}"]',
    )
    db.add_all([room, stage])
    await db.commit()
    return customer, lead, first, second, project, room, stage


@pytest.mark.asyncio
async def test_lead_sync_is_idempotent_and_canonical(db):
    customer, lead, _, _, project, _, _ = await _seed(db, "lead")

    first = await participant_service.sync_current_lead_in_transaction(
        db,
        project=project,
        contractor_id=lead.id,
        actor_id=customer.id,
    )
    await db.commit()
    second = await participant_service.sync_current_lead_in_transaction(
        db,
        project=project,
        contractor_id=lead.id,
        actor_id=customer.id,
    )
    await db.commit()

    assert first.id == second.id
    assert project.contractor_id == lead.id
    assert second.participant_role == "lead_contractor"
    assert second.status == "active"
    assert second.all_scope is True
    assert second.can_manage_schedule is True
    assert second.can_manage_commercial is True
    assert second.can_manage_documents is True
    assert await participant_service.participant_scopes(db, second.id) == []
    assert int(
        await db.scalar(
            select(func.count())
            .select_from(ProjectParticipantEvent)
            .where(ProjectParticipantEvent.participant_id == second.id)
        )
        or 0
    ) == 1


@pytest.mark.asyncio
async def test_lead_sync_promotes_independent_principal_and_clears_narrow_scope(db):
    customer, _, contractor, _, project, _, stage = await _seed(db, "promote")
    participant, _ = await participant_service.add_or_reactivate_contractor(
        db,
        project_id=project.id,
        actor_id=customer.id,
        contractor_id=contractor.id,
        scopes=[("stage", stage.id)],
    )
    assert len(await participant_service.participant_scopes(db, participant.id)) == 1

    promoted = await participant_service.sync_current_lead_in_transaction(
        db,
        project=project,
        contractor_id=contractor.id,
        actor_id=customer.id,
    )
    await db.commit()

    assert promoted.id == participant.id
    assert promoted.participant_role == "lead_contractor"
    assert promoted.all_scope is True
    assert await participant_service.participant_scopes(db, promoted.id) == []
    events = list(
        (
            await db.execute(
                select(ProjectParticipantEvent.event_type)
                .where(ProjectParticipantEvent.participant_id == promoted.id)
                .order_by(ProjectParticipantEvent.created_at, ProjectParticipantEvent.id)
            )
        ).scalars().all()
    )
    assert events == ["added", "scope_replaced"]


@pytest.mark.asyncio
async def test_atomic_project_create_with_contractor_commits_lead_truth(db):
    customer = User(
        id="mgmt-create-customer",
        phone="+78881110001",
        role=UserRole.customer,
    )
    contractor = User(
        id="mgmt-create-contractor",
        phone="+78881110002",
        role=UserRole.contractor,
    )
    db.add_all([customer, contractor])
    await db.commit()

    result = await project_create_service.create_project(
        db,
        customer_id=customer.id,
        name="Marketplace-safe project",
        address=None,
        renovation_type="cosmetic",
        rooms_data=[
            {
                "name": "Комната",
                "length_m": 4,
                "width_m": 3,
                "height_m": 2.7,
                "room_type": "living",
            }
        ],
        contractor_id=contractor.id,
        client_request_id="mgmt-create-0001",
        scope=project_create_service.PROJECT_MARKETPLACE_CREATE_SCOPE,
        participant_actor_id=customer.id,
    )

    participant = await participant_service.active_participant(
        db,
        project_id=result.project.id,
        user_id=contractor.id,
    )
    assert result.replayed is False
    assert result.project.contractor_id == contractor.id
    assert participant is not None
    assert participant.participant_role == "lead_contractor"
    assert participant.all_scope is True

    replay = await project_create_service.create_project(
        db,
        customer_id=customer.id,
        name="Marketplace-safe project",
        address=None,
        renovation_type="cosmetic",
        rooms_data=[
            {
                "name": "Комната",
                "length_m": 4,
                "width_m": 3,
                "height_m": 2.7,
                "room_type": "living",
            }
        ],
        contractor_id=contractor.id,
        client_request_id="mgmt-create-0001",
        scope=project_create_service.PROJECT_MARKETPLACE_CREATE_SCOPE,
        participant_actor_id=customer.id,
    )
    assert replay.replayed is True
    assert replay.project.id == result.project.id
    assert int(
        await db.scalar(
            select(func.count())
            .select_from(ProjectParticipant)
            .where(ProjectParticipant.project_id == result.project.id)
        )
        or 0
    ) == 1


@pytest.mark.asyncio
async def test_customer_management_api_preserves_generic_acl_boundary(db):
    customer, _, contractor, _, project, room, stage = await _seed(db, "api")
    created = await participant_api.add_participant(
        project.id,
        participant_api.ParticipantCreateIn(
            contractor_id=contractor.id,
            scopes=[
                participant_api.ParticipantScopeIn(
                    scope_type="stage",
                    scope_ref=stage.id,
                )
            ],
        ),
        user=customer,
        db=db,
    )
    participant_id = created.participant.id
    assert created.created is True
    assert created.participant.full_name == "Электрик"
    assert created.participant.scopes[0].scope_ref == stage.id
    assert await team_service.can_access_project(db, contractor, project, write=False) is False
    assert await team_service.can_access_project(db, contractor, project, write=True) is False

    replaced = await participant_api.replace_participant_scopes(
        project.id,
        participant_id,
        participant_api.ParticipantScopesIn(
            scopes=[
                participant_api.ParticipantScopeIn(
                    scope_type="room",
                    scope_ref=room.id,
                )
            ]
        ),
        user=customer,
        db=db,
    )
    assert [(scope.scope_type, scope.scope_ref) for scope in replaced.scopes] == [
        ("room", room.id)
    ]

    listed = await participant_api.list_participants(
        project.id,
        include_removed=False,
        user=customer,
        db=db,
    )
    assert [row.id for row in listed] == [participant_id]

    removed = await participant_api.remove_participant(
        project.id,
        participant_id,
        user=customer,
        db=db,
    )
    assert removed.status == "removed"
    assert await participant_api.list_participants(
        project.id,
        include_removed=False,
        user=customer,
        db=db,
    ) == []


@pytest.mark.asyncio
async def test_non_owner_cannot_manage_participants(db):
    customer, _, contractor, _, project, _, _ = await _seed(db, "deny")
    with pytest.raises(HTTPException) as error:
        await participant_api.list_participants(
            project.id,
            include_removed=False,
            user=contractor,
            db=db,
        )
    assert error.value.status_code == 403
    assert customer.id != contractor.id


def test_runtime_has_only_canonical_assignment_conversion_and_management_routes():
    expected = {
        ("/api/v1/projects/{project_id}/assign", "POST"),
        ("/api/v1/projects/{project_id}/contractor", "POST"),
        ("/api/v1/job-leads/{lead_id}/convert", "POST"),
        ("/api/v1/projects/{project_id}/participants", "GET"),
        ("/api/v1/projects/{project_id}/participants", "POST"),
        ("/api/v1/projects/{project_id}/participants/{participant_id}/scopes", "PATCH"),
        ("/api/v1/projects/{project_id}/participants/{participant_id}", "DELETE"),
    }
    counts = {signature: 0 for signature in expected}
    for route in iter_route_contexts(app.routes):
        methods = set(route.methods or set())
        for signature in expected:
            path, method = signature
            if route.path == path and method in methods:
                counts[signature] += 1
    assert counts == {signature: 1 for signature in expected}
