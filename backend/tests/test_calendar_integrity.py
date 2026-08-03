from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1 import calendar_integrity
from app.core.timeutil import utc_now
from app.main import app
from app.models.entities import (
    CalendarItem,
    Project,
    ProjectViewer,
    Stage,
    StageStatus,
    Team,
    TeamMember,
    User,
    UserRole,
)
from app.services import calendar_integrity_service as calendar_svc


def _dt(days: int, hour: int = 9) -> datetime:
    return (utc_now() + timedelta(days=days)).replace(
        hour=hour,
        minute=0,
        second=0,
        microsecond=0,
    )


async def seed_calendar_graph(db, suffix: str):
    tail = sum((index + 1) * ord(char) for index, char in enumerate(suffix)) % 10_000_000
    customer_a = User(
        id=f"calendar-customer-a-{suffix}",
        phone=f"+7810{tail:07d}",
        role=UserRole.customer,
    )
    contractor_a = User(
        id=f"calendar-contractor-a-{suffix}",
        phone=f"+7820{tail:07d}",
        role=UserRole.contractor,
        ics_token=f"calendar-token-a-{suffix}-1234567890",
    )
    customer_b = User(
        id=f"calendar-customer-b-{suffix}",
        phone=f"+7830{tail:07d}",
        role=UserRole.customer,
    )
    contractor_b = User(
        id=f"calendar-contractor-b-{suffix}",
        phone=f"+7840{tail:07d}",
        role=UserRole.contractor,
        ics_token=f"calendar-token-b-{suffix}-1234567890",
    )
    team_member = User(
        id=f"calendar-team-member-{suffix}",
        phone=f"+7850{tail:07d}",
        role=UserRole.contractor,
    )
    viewer = User(
        id=f"calendar-viewer-{suffix}",
        phone=f"+7860{tail:07d}",
        role=UserRole.contractor,
    )
    project_a = Project(
        id=f"calendar-project-a-{suffix}",
        name="Project A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor_a.id,
    )
    project_b = Project(
        id=f"calendar-project-b-{suffix}",
        name="Project B",
        renovation_type="cosmetic",
        customer_id=customer_b.id,
        contractor_id=contractor_b.id,
    )
    team = Team(
        id=f"calendar-team-{suffix}",
        name="Project A team",
        owner_id=contractor_a.id,
    )
    db.add_all(
        [
            customer_a,
            contractor_a,
            customer_b,
            contractor_b,
            team_member,
            viewer,
            project_a,
            project_b,
            team,
            TeamMember(
                id=f"calendar-team-membership-{suffix}",
                team_id=team.id,
                user_id=team_member.id,
                role="member",
            ),
            ProjectViewer(
                id=f"calendar-viewer-grant-{suffix}",
                project_id=project_a.id,
                user_id=viewer.id,
            ),
        ]
    )
    await db.commit()
    return {
        "customer_a": customer_a,
        "contractor_a": contractor_a,
        "customer_b": customer_b,
        "contractor_b": contractor_b,
        "team_member": team_member,
        "viewer": viewer,
        "project_a": project_a,
        "project_b": project_b,
    }


@pytest.mark.asyncio
async def test_public_events_are_scoped_to_accessible_projects_across_list_upcoming_and_ics(db):
    graph = await seed_calendar_graph(db, "visibility")
    project_a_id = graph["project_a"].id
    project_b_id = graph["project_b"].id
    contractor_a_id = graph["contractor_a"].id
    contractor_b_id = graph["contractor_b"].id
    token_b = graph["contractor_b"].ics_token
    start_at = _dt(1)
    end_at = _dt(1, 18)
    events = [
        CalendarItem(
            id="calendar-public-a",
            user_id=contractor_a_id,
            project_id=project_a_id,
            title="PUBLIC_PROJECT_A",
            start_at=start_at,
            end_at=end_at,
            is_public=True,
        ),
        CalendarItem(
            id="calendar-public-b",
            user_id=contractor_b_id,
            project_id=project_b_id,
            title="PUBLIC_PROJECT_B",
            start_at=start_at,
            end_at=end_at,
            is_public=True,
        ),
        CalendarItem(
            id="calendar-private-b",
            user_id=contractor_b_id,
            project_id=None,
            title="PRIVATE_B",
            start_at=start_at,
            end_at=end_at,
            is_public=False,
        ),
        CalendarItem(
            id="calendar-global-public",
            user_id=contractor_a_id,
            project_id=None,
            title="GLOBAL_PUBLIC_MUST_NOT_LEAK",
            start_at=start_at,
            end_at=end_at,
            is_public=True,
        ),
    ]
    db.add_all(events)
    await db.commit()
    actor = await db.get(User, contractor_b_id)
    assert actor is not None

    visible = await calendar_svc.visible_items(db, user=actor)
    titles = {item.title for item in visible}
    assert titles == {"PUBLIC_PROJECT_B", "PRIVATE_B"}

    upcoming = await calendar_integrity.upcoming_calendar(
        days=30,
        limit=100,
        user=actor,
        db=db,
    )
    assert {item["title"] for item in upcoming} == {"PUBLIC_PROJECT_B", "PRIVATE_B"}

    response = await calendar_integrity.calendar_ics(token=token_b, db=db)
    ics = response.body.decode("utf-8")
    assert "PUBLIC_PROJECT_B" in ics
    assert "PRIVATE_B" in ics
    assert "PUBLIC_PROJECT_A" not in ics
    assert "GLOBAL_PUBLIC_MUST_NOT_LEAK" not in ics


@pytest.mark.asyncio
async def test_team_member_and_project_viewer_receive_only_granted_project_public_events(db):
    graph = await seed_calendar_graph(db, "grants")
    project_a_id = graph["project_a"].id
    project_b_id = graph["project_b"].id
    contractor_a_id = graph["contractor_a"].id
    contractor_b_id = graph["contractor_b"].id
    db.add_all(
        [
            CalendarItem(
                id="calendar-granted-a",
                user_id=contractor_a_id,
                project_id=project_a_id,
                title="GRANTED_A",
                start_at=_dt(1),
                end_at=_dt(1, 18),
                is_public=True,
            ),
            CalendarItem(
                id="calendar-ungranted-b",
                user_id=contractor_b_id,
                project_id=project_b_id,
                title="UNGRANTED_B",
                start_at=_dt(1),
                end_at=_dt(1, 18),
                is_public=True,
            ),
        ]
    )
    await db.commit()

    for actor_id in (graph["team_member"].id, graph["viewer"].id):
        actor = await db.get(User, actor_id)
        assert actor is not None
        titles = {
            item.title
            for item in await calendar_svc.visible_items(db, user=actor)
        }
        assert titles == {"GRANTED_A"}


@pytest.mark.asyncio
async def test_project_filtered_list_requires_object_level_access(db):
    graph = await seed_calendar_graph(db, "project-acl")
    outsider_id = graph["contractor_b"].id
    project_a_id = graph["project_a"].id
    outsider = await db.get(User, outsider_id)
    assert outsider is not None

    with pytest.raises(HTTPException) as error:
        await calendar_integrity.list_calendar(
            project_id=project_a_id,
            start_at=None,
            end_at=None,
            date_from=None,
            date_to=None,
            from_alias=None,
            to_alias=None,
            limit=500,
            user=outsider,
            db=db,
        )
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_stage_sync_reconciles_fields_removes_duplicates_and_is_replay_safe(db):
    graph = await seed_calendar_graph(db, "sync")
    project_id = graph["project_a"].id
    actor_id = graph["contractor_a"].id
    stage = Stage(
        id="calendar-sync-stage",
        project_id=project_id,
        name="Финишная отделка",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 8, 10),
        planned_end=date(2026, 8, 12),
    )
    db.add_all(
        [
            stage,
            CalendarItem(
                id="calendar-sync-a-canonical",
                user_id=actor_id,
                project_id=project_id,
                stage_id=stage.id,
                title="Старое название",
                description="Старое описание",
                start_at=datetime(2026, 1, 1, 9, tzinfo=timezone.utc),
                end_at=datetime(2026, 1, 1, 18, tzinfo=timezone.utc),
                event_type="other",
                color="#000000",
                is_public=False,
            ),
            CalendarItem(
                id="calendar-sync-b-duplicate",
                user_id=actor_id,
                project_id=project_id,
                stage_id=stage.id,
                title="Дубликат",
                start_at=datetime(2026, 1, 2, 9, tzinfo=timezone.utc),
                end_at=datetime(2026, 1, 2, 18, tzinfo=timezone.utc),
                is_public=True,
            ),
            CalendarItem(
                id="calendar-sync-stale",
                user_id=actor_id,
                project_id=project_id,
                stage_id="removed-stage",
                title="Устаревшая проекция",
                start_at=datetime(2026, 1, 3, 9, tzinfo=timezone.utc),
                end_at=datetime(2026, 1, 3, 18, tzinfo=timezone.utc),
                is_public=True,
            ),
        ]
    )
    await db.commit()
    actor = await db.get(User, actor_id)
    assert actor is not None

    first = await calendar_svc.sync_project_stages(
        db,
        project_id=project_id,
        actor=actor,
    )
    assert first is not None
    assert (first.created, first.updated, first.deleted) == (0, 1, 2)
    items = list(
        (
            await db.execute(
                select(CalendarItem).where(
                    CalendarItem.user_id == actor_id,
                    CalendarItem.project_id == project_id,
                    CalendarItem.stage_id.is_not(None),
                )
            )
        ).scalars().all()
    )
    assert len(items) == 1
    item = items[0]
    assert item.id == "calendar-sync-a-canonical"
    assert item.title == "Финишная отделка"
    assert item.description == "Этап проекта"
    assert item.event_type == "stage"
    assert item.color == "#4F46E5"
    assert item.is_public is True
    assert item.all_day is True
    assert item.start_at.date() == date(2026, 8, 10)
    assert item.end_at.date() == date(2026, 8, 12)

    actor = await db.get(User, actor_id)
    assert actor is not None
    replay = await calendar_svc.sync_project_stages(
        db,
        project_id=project_id,
        actor=actor,
    )
    assert replay is not None
    assert (replay.created, replay.updated, replay.deleted) == (0, 0, 0)
    assert await db.scalar(
        select(func.count())
        .select_from(CalendarItem)
        .where(
            CalendarItem.user_id == actor_id,
            CalendarItem.project_id == project_id,
            CalendarItem.stage_id == stage.id,
        )
    ) == 1


@pytest.mark.asyncio
async def test_stage_without_start_removes_legacy_projection(db):
    graph = await seed_calendar_graph(db, "stale")
    project_id = graph["project_a"].id
    actor_id = graph["contractor_a"].id
    stage = Stage(
        id="calendar-unscheduled-stage",
        project_id=project_id,
        name="Без даты",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=None,
        planned_end=None,
    )
    item = CalendarItem(
        id="calendar-unscheduled-projection",
        user_id=actor_id,
        project_id=project_id,
        stage_id=stage.id,
        title="Устаревшая дата",
        start_at=_dt(1),
        end_at=_dt(1, 18),
        is_public=True,
    )
    db.add_all([stage, item])
    await db.commit()
    actor = await db.get(User, actor_id)
    assert actor is not None

    result = await calendar_svc.sync_project_stages(
        db,
        project_id=project_id,
        actor=actor,
    )

    assert result is not None
    assert (result.created, result.updated, result.deleted) == (0, 0, 1)
    assert await db.get(CalendarItem, item.id) is None


@pytest.mark.asyncio
async def test_sync_rejects_unrelated_actor_at_service_boundary(db):
    graph = await seed_calendar_graph(db, "sync-acl")
    project_id = graph["project_a"].id
    outsider_id = graph["contractor_b"].id
    outsider = await db.get(User, outsider_id)
    assert outsider is not None

    with pytest.raises(ValueError, match="calendar_sync_forbidden"):
        await calendar_svc.sync_project_stages(
            db,
            project_id=project_id,
            actor=outsider,
        )
    assert await db.scalar(
        select(func.count())
        .select_from(CalendarItem)
        .where(CalendarItem.project_id == project_id)
    ) == 0


@pytest.mark.asyncio
async def test_sync_failure_rolls_back_updates_deletes_and_creates(db, monkeypatch):
    graph = await seed_calendar_graph(db, "rollback")
    project_id = graph["project_a"].id
    actor_id = graph["contractor_a"].id
    first_stage = Stage(
        id="calendar-rollback-stage-a",
        project_id=project_id,
        name="Stage A new",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 8, 20),
        planned_end=date(2026, 8, 21),
    )
    second_stage = Stage(
        id="calendar-rollback-stage-b",
        project_id=project_id,
        name="Stage B",
        sort_order=1,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 8, 22),
        planned_end=date(2026, 8, 23),
    )
    existing = CalendarItem(
        id="calendar-rollback-existing",
        user_id=actor_id,
        project_id=project_id,
        stage_id=first_stage.id,
        title="Stage A old",
        start_at=datetime(2026, 1, 1, 9, tzinfo=timezone.utc),
        end_at=datetime(2026, 1, 1, 18, tzinfo=timezone.utc),
        is_public=False,
    )
    db.add_all([first_stage, second_stage, existing])
    await db.commit()
    existing_id = existing.id
    original_apply = calendar_svc._apply_stage_projection

    def fail_on_second(item, stage, target_project_id):
        if stage.id == second_stage.id:
            raise RuntimeError("synthetic_calendar_sync_failure")
        return original_apply(item, stage, target_project_id)

    monkeypatch.setattr(calendar_svc, "_apply_stage_projection", fail_on_second)
    actor = await db.get(User, actor_id)
    assert actor is not None
    with pytest.raises(RuntimeError, match="synthetic_calendar_sync_failure"):
        await calendar_svc.sync_project_stages(
            db,
            project_id=project_id,
            actor=actor,
        )

    assert await db.scalar(
        select(CalendarItem.title).where(CalendarItem.id == existing_id)
    ) == "Stage A old"
    assert await db.scalar(
        select(func.count())
        .select_from(CalendarItem)
        .where(
            CalendarItem.user_id == actor_id,
            CalendarItem.project_id == project_id,
        )
    ) == 1


@pytest.mark.asyncio
async def test_runtime_has_only_canonical_calendar_integrity_handlers():
    signatures = {
        ("/api/v1/calendar", "GET"),
        ("/api/v1/calendar/upcoming", "GET"),
        ("/api/v1/calendar/ics", "GET"),
        ("/api/v1/calendar/sync-stages/{project_id}", "POST"),
    }
    for path, method in signatures:
        matches = [
            route
            for route in app.routes
            if getattr(route, "path", None) == path
            and method in (getattr(route, "methods", set()) or set())
        ]
        assert len(matches) == 1, (path, method, matches)
        assert matches[0].endpoint.__module__ == "app.api.v1.calendar_integrity"

    legacy_sync = [
        route
        for route in app.routes
        if "sync-stages" in (getattr(route, "path", "") or "")
        and getattr(getattr(route, "endpoint", None), "__module__", "")
        == "app.api.v1.calendar"
    ]
    assert not legacy_sync, [
        (route.path, sorted(route.methods or set())) for route in legacy_sync
    ]
