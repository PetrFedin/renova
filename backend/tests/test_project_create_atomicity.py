from datetime import date, timedelta
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

import app.models.client_write_request  # noqa: F401
from app.api.v1 import project_creation as creation_api
from app.main import app
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import (
    ActivityEvent,
    DomainOutbox,
    EstimateLine,
    Project,
    Room,
    Stage,
    StageStatus,
    User,
    UserRole,
)
from app.services import project_create_service as creation
from app.services.calc.estimate import stages_for_renovation
from app.services.client_write_idempotency import IdempotencyConflict


async def seed_customer(db, suffix: str, *, role: UserRole = UserRole.customer) -> User:
    tail = sum((index + 1) * ord(char) for index, char in enumerate(suffix)) % 10_000_000
    user = User(
        id=f"project-create-user-{suffix}",
        phone=f"+7601{tail:07d}",
        role=role,
    )
    db.add(user)
    await db.commit()
    return user


def rooms_payload() -> list[dict]:
    return [
        {
            "name": "Гостиная",
            "room_type": "living",
            "length_m": 4,
            "width_m": 3,
            "height_m": 2.7,
            "openings_sq_m": 2,
            "outlets_count": 3,
            "switches_count": 1,
            "plumbing_points": 0,
        },
        {
            "name": "Санузел",
            "room_type": "bathroom",
            "length_m": 3,
            "width_m": 2,
            "height_m": 2.7,
            "openings_sq_m": 1,
            "outlets_count": 1,
            "switches_count": 1,
            "plumbing_points": 2,
        },
    ]


@pytest.mark.asyncio
async def test_complete_project_is_one_consistent_commit(db):
    customer = await seed_customer(db, "complete")
    customer_id = customer.id
    start = date(2026, 9, 1)
    end = date(2026, 10, 30)

    result = await creation.create_project(
        db,
        customer_id=customer_id,
        name="Квартира",
        address="Москва",
        renovation_type="capital",
        property_type="apartment",
        total_area_sqm=None,
        planned_start_date=start,
        planned_end_date=end,
        rooms_data=rooms_payload(),
        client_request_id="project-complete-0001",
    )
    project = result.project
    project_id = project.id

    assert result.replayed is False
    assert project.total_area_sqm == 18
    assert len(project.rooms) == 2
    assert {line.category for line in project.estimate_lines} >= {
        "finish",
        "electrical",
        "plumbing",
    }

    calculated_budget = sum(
        line.quantity_planned * line.unit_price
        for line in project.estimate_lines
    )
    assert project.budget_planned == pytest.approx(calculated_budget, abs=0.01)

    stages = sorted(project.stages, key=lambda stage: stage.sort_order)
    assert len(stages) == len(stages_for_renovation("capital"))
    assert stages[0].status == StageStatus.active
    assert all(stage.status == StageStatus.planned for stage in stages[1:])
    assert stages[0].planned_start == start
    assert stages[-1].planned_end == end
    for previous, following in zip(stages, stages[1:]):
        assert following.planned_start == previous.planned_end + timedelta(days=1)
    assert round(sum(stage.payment_amount for stage in stages), 2) == round(
        project.budget_planned,
        2,
    )

    wet_room_id = next(room.id for room in project.rooms if room.room_type == "bathroom")
    wet_stage_rooms = {
        room_id
        for stage in stages
        if any(marker in stage.name.lower() for marker in ("сантех", "гидро", "плитк"))
        for room_id in (json.loads(stage.room_ids_json) if stage.room_ids_json else [])
    }
    assert wet_room_id in wet_stage_rooms

    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_type == "project",
            DomainOutbox.aggregate_id == project_id,
        )
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(ActivityEvent)
        .where(
            ActivityEvent.project_id == project_id,
            ActivityEvent.kind == "ProjectCreated",
        )
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(ClientWriteRequest)
        .where(
            ClientWriteRequest.scope == creation.PROJECT_CREATE_SCOPE,
            ClientWriteRequest.entity_id == project_id,
        )
    ) == 1


@pytest.mark.asyncio
async def test_project_create_replay_and_payload_conflict_do_not_leak_candidates(db):
    customer = await seed_customer(db, "replay")
    customer_id = customer.id
    kwargs = {
        "customer_id": customer_id,
        "name": "Один объект",
        "address": None,
        "renovation_type": "cosmetic",
        "property_type": "apartment",
        "total_area_sqm": None,
        "planned_start_date": date(2026, 9, 1),
        "planned_end_date": date(2026, 10, 30),
        "rooms_data": rooms_payload(),
        "client_request_id": "project-replay-0001",
    }

    first = await creation.create_project(db, **kwargs)
    project_id = first.project.id
    counts_before = {
        "projects": await db.scalar(select(func.count()).select_from(Project)),
        "rooms": await db.scalar(select(func.count()).select_from(Room)),
        "lines": await db.scalar(select(func.count()).select_from(EstimateLine)),
        "stages": await db.scalar(select(func.count()).select_from(Stage)),
        "outbox": await db.scalar(select(func.count()).select_from(DomainOutbox)),
    }
    second = await creation.create_project(db, **kwargs)

    assert second.replayed is True
    assert second.project.id == project_id
    assert await db.scalar(select(func.count()).select_from(Project)) == counts_before["projects"]
    assert await db.scalar(select(func.count()).select_from(Room)) == counts_before["rooms"]
    assert await db.scalar(select(func.count()).select_from(EstimateLine)) == counts_before["lines"]
    assert await db.scalar(select(func.count()).select_from(Stage)) == counts_before["stages"]
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == counts_before["outbox"]

    conflicting = {**kwargs, "name": "Другой объект"}
    with pytest.raises(IdempotencyConflict):
        await creation.create_project(db, **conflicting)
    assert await db.scalar(select(func.count()).select_from(Project)) == 1
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 1


@pytest.mark.asyncio
async def test_failure_after_rooms_and_stages_rolls_back_everything(db, monkeypatch):
    customer = await seed_customer(db, "rollback")
    customer_id = customer.id

    async def fail_activity(*_args, **_kwargs):
        raise RuntimeError("synthetic_project_activity_failure")

    monkeypatch.setattr(creation, "_prepare_activity", fail_activity)
    with pytest.raises(RuntimeError, match="synthetic_project_activity_failure"):
        await creation.create_project(
            db,
            customer_id=customer_id,
            name="Не должен сохраниться",
            address=None,
            renovation_type="cosmetic",
            property_type="apartment",
            total_area_sqm=None,
            planned_start_date=date(2026, 9, 1),
            planned_end_date=date(2026, 10, 30),
            rooms_data=rooms_payload(),
            client_request_id="project-rollback-0001",
        )

    assert await db.scalar(select(func.count()).select_from(Project)) == 0
    assert await db.scalar(select(func.count()).select_from(Room)) == 0
    assert await db.scalar(select(func.count()).select_from(EstimateLine)) == 0
    assert await db.scalar(select(func.count()).select_from(Stage)) == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 0


@pytest.mark.asyncio
async def test_too_short_schedule_fails_without_partial_project(db):
    customer = await seed_customer(db, "short")
    with pytest.raises(ValueError, match="project_schedule_too_short"):
        await creation.create_project(
            db,
            customer_id=customer.id,
            name="Слишком короткий",
            address=None,
            renovation_type="cosmetic",
            property_type="apartment",
            total_area_sqm=None,
            planned_start_date=date(2026, 9, 1),
            planned_end_date=date(2026, 9, 1),
            rooms_data=rooms_payload(),
            client_request_id="project-short-0001",
        )
    assert await db.scalar(select(func.count()).select_from(Project)) == 0
    assert await db.scalar(select(func.count()).select_from(Room)) == 0
    assert await db.scalar(select(func.count()).select_from(EstimateLine)) == 0
    assert await db.scalar(select(func.count()).select_from(Stage)) == 0


@pytest.mark.asyncio
async def test_template_creation_is_replay_safe_and_unknown_template_is_fail_closed(db):
    customer = await seed_customer(db, "template")
    customer_id = customer.id
    first = await creation.create_from_template(
        db,
        customer_id=customer_id,
        template_id="studio",
        name="Моя студия",
        client_request_id="project-template-0001",
    )
    second = await creation.create_from_template(
        db,
        customer_id=customer_id,
        template_id="studio",
        name="Моя студия",
        client_request_id="project-template-0001",
    )

    assert first.replayed is False
    assert second.replayed is True
    assert second.project.id == first.project.id
    assert len(first.project.rooms) == 2
    assert await db.scalar(select(func.count()).select_from(Project)) == 1

    with pytest.raises(ValueError, match="unknown_template"):
        await creation.create_from_template(
            db,
            customer_id=customer_id,
            template_id="not-a-template",
            client_request_id="project-template-unknown",
        )
    assert await db.scalar(select(func.count()).select_from(Project)) == 1


@pytest.mark.asyncio
async def test_non_customer_cannot_use_canonical_creation_endpoint(db):
    contractor = await seed_customer(db, "forbidden", role=UserRole.contractor)
    body = creation_api.ProjectCreateIn(
        name="Запрещено",
        renovation_type="cosmetic",
        property_type="apartment",
        rooms=rooms_payload(),
        client_request_id="project-forbidden-0001",
    )
    with pytest.raises(HTTPException) as captured:
        await creation_api.create_project(body, user=contractor, db=db)
    assert captured.value.status_code == 403
    assert await db.scalar(select(func.count()).select_from(Project)) == 0


def test_runtime_has_one_canonical_project_creation_handler():
    counts: dict[str, int] = {}
    for route in app.routes:
        methods = set(getattr(route, "methods", set()) or set())
        path = getattr(route, "path", "")
        if "POST" in methods and path in {
            "/api/v1/projects",
            "/api/v1/projects/from-template",
        }:
            counts[path] = counts.get(path, 0) + 1
    assert counts == {
        "/api/v1/projects": 1,
        "/api/v1/projects/from-template": 1,
    }
