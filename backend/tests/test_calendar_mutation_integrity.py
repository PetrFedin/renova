from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.routing import iter_route_contexts
from sqlalchemy import func, select

from app.core.timeutil import utc_now
from app.main import app
from app.models.entities import (
    CalendarItem,
    Project,
    ProjectViewer,
    Stage,
    StageStatus,
    User,
    UserRole,
)
from app.services import calendar_mutation_service as mutations


async def seed_mutation_graph(db, suffix: str):
    tail = sum((i + 1) * ord(c) for i, c in enumerate(suffix)) % 10_000_000
    customer = User(
        id=f"calendar-mutation-customer-{suffix}",
        phone=f"+7910{tail:07d}",
        role=UserRole.customer,
    )
    contractor = User(
        id=f"calendar-mutation-contractor-{suffix}",
        phone=f"+7920{tail:07d}",
        role=UserRole.contractor,
    )
    outsider = User(
        id=f"calendar-mutation-outsider-{suffix}",
        phone=f"+7930{tail:07d}",
        role=UserRole.contractor,
    )
    viewer = User(
        id=f"calendar-mutation-viewer-{suffix}",
        phone=f"+7940{tail:07d}",
        role=UserRole.contractor,
    )
    project = Project(
        id=f"calendar-mutation-project-{suffix}",
        name="Calendar mutation project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    other_project = Project(
        id=f"calendar-mutation-other-{suffix}",
        name="Other project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=outsider.id,
    )
    stage = Stage(
        id=f"calendar-mutation-stage-{suffix}",
        project_id=project.id,
        name="Stage",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 9, 10),
        planned_end=date(2026, 9, 12),
    )
    db.add_all(
        [
            customer,
            contractor,
            outsider,
            viewer,
            project,
            other_project,
            stage,
            ProjectViewer(
                id=f"calendar-mutation-viewer-grant-{suffix}",
                project_id=project.id,
                user_id=viewer.id,
            ),
        ]
    )
    await db.commit()
    return {
        "customer_id": customer.id,
        "contractor_id": contractor.id,
        "outsider_id": outsider.id,
        "viewer_id": viewer.id,
        "project_id": project.id,
        "other_project_id": other_project.id,
        "stage_id": stage.id,
    }


def interval():
    start = (utc_now() + timedelta(days=2)).replace(
        minute=0,
        second=0,
        microsecond=0,
    )
    return start, start + timedelta(hours=2)


@pytest.mark.asyncio
async def test_personal_item_create_replay_update_and_delete(db):
    graph = await seed_mutation_graph(db, "personal")
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    start, end = interval()

    created = await mutations.create_item(
        db,
        actor=actor,
        title="  Личная встреча  ",
        start_at=start,
        end_at=end,
        reminder_at=start - timedelta(minutes=30),
    )
    item_id = created.item.id
    assert created.replayed is False
    assert created.item.title == "Личная встреча"
    assert created.item.color == "#4F46E5"
    assert created.item.project_id is None

    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    replay = await mutations.update_item(
        db,
        actor=actor,
        item_id=item_id,
        changes={"title": "Личная встреча"},
    )
    assert replay is not None and replay.replayed is True

    item = await db.get(CalendarItem, item_id)
    assert item is not None
    item.reminder_sent = True
    await db.commit()
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    updated = await mutations.update_item(
        db,
        actor=actor,
        item_id=item_id,
        changes={
            "title": "Перенесённая встреча",
            "start_at": start + timedelta(hours=1),
            "end_at": end + timedelta(hours=1),
            "reminder_at": start,
        },
    )
    assert updated is not None and updated.replayed is False
    assert updated.item.title == "Перенесённая встреча"
    assert updated.item.reminder_sent is False

    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    assert await mutations.delete_item(db, actor=actor, item_id=item_id) is True
    assert await db.get(CalendarItem, item_id) is None


@pytest.mark.asyncio
async def test_create_rejects_invalid_interval_reminder_color_and_stage_type(db):
    graph = await seed_mutation_graph(db, "invalid")
    actor_id = graph["contractor_id"]
    start, end = interval()
    cases = [
        ({"start_at": start, "end_at": start}, "calendar_interval_invalid"),
        (
            {
                "start_at": start,
                "end_at": end,
                "reminder_at": start + timedelta(minutes=1),
            },
            "calendar_reminder_after_start",
        ),
        (
            {"start_at": start, "end_at": end, "color": "red"},
            "calendar_color_invalid",
        ),
        (
            {"start_at": start, "end_at": end, "event_type": "stage"},
            "calendar_stage_projection_managed",
        ),
    ]
    for values, code in cases:
        actor = await db.get(User, actor_id)
        assert actor is not None
        with pytest.raises(ValueError, match=code):
            await mutations.create_item(
                db,
                actor=actor,
                title="Invalid",
                **values,
            )
        await db.rollback()
    assert await db.scalar(select(func.count()).select_from(CalendarItem)) == 0


@pytest.mark.asyncio
async def test_foreign_project_and_read_only_viewer_cannot_create(db):
    graph = await seed_mutation_graph(db, "foreign")
    start, end = interval()

    outsider = await db.get(User, graph["outsider_id"])
    assert outsider is not None
    with pytest.raises(ValueError, match="calendar_project_write_forbidden"):
        await mutations.create_item(
            db,
            actor=outsider,
            title="Foreign",
            start_at=start,
            end_at=end,
            project_id=graph["project_id"],
        )

    viewer = await db.get(User, graph["viewer_id"])
    assert viewer is not None
    with pytest.raises(ValueError, match="calendar_project_write_forbidden"):
        await mutations.create_item(
            db,
            actor=viewer,
            title="Read only",
            start_at=start,
            end_at=end,
            project_id=graph["project_id"],
        )
    assert await db.scalar(select(func.count()).select_from(CalendarItem)) == 0


@pytest.mark.asyncio
async def test_stage_link_derives_project_and_rejects_cross_project_mismatch(db):
    graph = await seed_mutation_graph(db, "stage-link")
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    start, end = interval()

    linked = await mutations.create_item(
        db,
        actor=actor,
        title="Замер",
        start_at=start,
        end_at=end,
        event_type="inspection",
        stage_id=graph["stage_id"],
    )
    assert linked.item.project_id == graph["project_id"]
    assert linked.item.stage_id == graph["stage_id"]

    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    with pytest.raises(ValueError, match="calendar_stage_project_mismatch"):
        await mutations.create_item(
            db,
            actor=actor,
            title="Mismatch",
            start_at=start,
            end_at=end,
            event_type="inspection",
            project_id=graph["other_project_id"],
            stage_id=graph["stage_id"],
        )


@pytest.mark.asyncio
async def test_unrelated_user_cannot_update_or_delete_public_item(db):
    graph = await seed_mutation_graph(db, "owner")
    start, end = interval()
    owner = await db.get(User, graph["contractor_id"])
    assert owner is not None
    created = await mutations.create_item(
        db,
        actor=owner,
        title="Общий созвон",
        start_at=start,
        end_at=end,
        is_public=True,
        project_id=graph["project_id"],
    )
    item_id = created.item.id

    outsider = await db.get(User, graph["outsider_id"])
    assert outsider is not None
    with pytest.raises(ValueError, match="calendar_item_owner_only"):
        await mutations.update_item(
            db,
            actor=outsider,
            item_id=item_id,
            changes={"title": "Hijacked"},
        )
    outsider = await db.get(User, graph["outsider_id"])
    assert outsider is not None
    with pytest.raises(ValueError, match="calendar_item_owner_only"):
        await mutations.delete_item(db, actor=outsider, item_id=item_id)

    assert await db.scalar(
        select(CalendarItem.title).where(CalendarItem.id == item_id)
    ) == "Общий созвон"


@pytest.mark.asyncio
async def test_canonical_stage_projection_cannot_be_patched_or_deleted(db):
    graph = await seed_mutation_graph(db, "managed")
    start, end = interval()
    item = CalendarItem(
        id="calendar-managed-stage-item",
        user_id=graph["contractor_id"],
        project_id=graph["project_id"],
        stage_id=graph["stage_id"],
        title="Managed",
        start_at=start,
        end_at=end,
        event_type="stage",
        is_public=True,
    )
    db.add(item)
    await db.commit()
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None

    with pytest.raises(ValueError, match="calendar_stage_projection_managed"):
        await mutations.update_item(
            db,
            actor=actor,
            item_id=item.id,
            changes={"title": "Manual override"},
        )
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    with pytest.raises(ValueError, match="calendar_stage_projection_managed"):
        await mutations.delete_item(db, actor=actor, item_id=item.id)
    assert await db.get(CalendarItem, item.id) is not None


@pytest.mark.asyncio
async def test_revoked_project_owner_cannot_mutate_or_delete_stale_item(db):
    graph = await seed_mutation_graph(db, "revoked")
    start, end = interval()
    item = CalendarItem(
        id="calendar-revoked-mutation-item",
        user_id=graph["contractor_id"],
        project_id=graph["project_id"],
        title="Stale",
        start_at=start,
        end_at=end,
        event_type="other",
        is_public=False,
    )
    db.add(item)
    project = await db.get(Project, graph["project_id"])
    assert project is not None
    project.contractor_id = graph["outsider_id"]
    await db.commit()
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None

    with pytest.raises(ValueError, match="calendar_project_write_forbidden"):
        await mutations.update_item(
            db,
            actor=actor,
            item_id=item.id,
            changes={"title": "Should fail"},
        )
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    with pytest.raises(ValueError, match="calendar_project_write_forbidden"):
        await mutations.delete_item(db, actor=actor, item_id=item.id)
    assert await db.scalar(
        select(CalendarItem.title).where(CalendarItem.id == item.id)
    ) == "Stale"


@pytest.mark.asyncio
async def test_null_required_patch_and_commit_failure_leave_original_row(db, monkeypatch):
    graph = await seed_mutation_graph(db, "rollback")
    start, end = interval()
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    created = await mutations.create_item(
        db,
        actor=actor,
        title="Original",
        start_at=start,
        end_at=end,
    )
    item_id = created.item.id

    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    with pytest.raises(ValueError, match="calendar_start_at_required"):
        await mutations.update_item(
            db,
            actor=actor,
            item_id=item_id,
            changes={"start_at": None},
        )

    original_commit = db.commit

    async def fail_commit():
        raise RuntimeError("synthetic_calendar_commit_failure")

    monkeypatch.setattr(db, "commit", fail_commit)
    actor = await db.get(User, graph["contractor_id"])
    assert actor is not None
    with pytest.raises(RuntimeError, match="synthetic_calendar_commit_failure"):
        await mutations.update_item(
            db,
            actor=actor,
            item_id=item_id,
            changes={"title": "Must roll back"},
        )
    monkeypatch.setattr(db, "commit", original_commit)

    assert await db.scalar(
        select(CalendarItem.title).where(CalendarItem.id == item_id)
    ) == "Original"


@pytest.mark.asyncio
async def test_runtime_has_one_canonical_calendar_mutation_handler_per_method():
    signatures = {
        ("/api/v1/calendar", "POST"),
        ("/api/v1/calendar/{item_id}", "PATCH"),
        ("/api/v1/calendar/{item_id}", "PUT"),
        ("/api/v1/calendar/{item_id}", "DELETE"),
    }
    for path, method in signatures:
        matches = [
            route
            for route in iter_route_contexts(app.routes)
            if route.path == path
            and method in (route.methods or set())
        ]
        assert len(matches) == 1, (path, method, matches)
        assert matches[0].endpoint.__module__ == "app.api.v1.calendar_mutations"
