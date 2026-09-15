from __future__ import annotations

from datetime import date
import uuid

import pytest
from sqlalchemy import func, select

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.services import calendar_import_service as import_svc
from app.services.client_write_idempotency import IdempotencyConflict


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _ics(*, uid: str = "external-event-1", summary: str = "External event", ymd: str = "20261001") -> str:
    return "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"SUMMARY:{summary}",
            f"DTSTART;VALUE=DATE:{ymd}",
            "END:VEVENT",
            "END:VCALENDAR",
        ]
    )


async def _seed(db):
    customer = User(
        id=_id("ical-customer"),
        phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
        role=UserRole.customer,
    )
    project = Project(
        id=_id("ical-project"),
        name="ICS replay",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    first = Stage(
        id=_id("ical-stage-a"),
        project_id=project.id,
        name="Stage A",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
    )
    second = Stage(
        id=_id("ical-stage-b"),
        project_id=project.id,
        name="Stage B",
        sort_order=1,
        status=StageStatus.planned,
        percent_complete=0,
    )
    db.add_all([customer, project, first, second])
    await db.commit()
    return customer.id, project.id, first.id, second.id


@pytest.mark.asyncio
async def test_calendar_import_replays_original_mapping_and_conflicts_on_changed_content(db):
    user_id, project_id, first_id, second_id = await _seed(db)
    content = _ics()

    first_result, replayed = await import_svc.import_ical(
        db,
        project_id=project_id,
        user_id=user_id,
        client_request_id="calendar-import-response-loss-001",
        content=content,
    )
    assert replayed is False
    assert first_result == {"ok": True, "parsed": 1, "updated_stages": 1}

    first = await db.get(Stage, first_id)
    second = await db.get(Stage, second_id)
    assert first is not None and second is not None
    assert first.planned_start == date(2026, 10, 1)
    assert first.planned_end == date(2026, 10, 1)
    assert first.ical_uid == "external-event-1"
    assert second.planned_start is None

    replay_result, replayed = await import_svc.import_ical(
        db,
        project_id=project_id,
        user_id=user_id,
        client_request_id="calendar-import-response-loss-001",
        content=content.replace("\r\n", "\n"),
    )
    assert replayed is True
    assert replay_result == first_result
    second = await db.get(Stage, second_id, populate_existing=True)
    assert second is not None and second.planned_start is None

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await import_svc.import_ical(
            db,
            project_id=project_id,
            user_id=user_id,
            client_request_id="calendar-import-response-loss-001",
            content=_ics(uid="external-event-2", ymd="20261002"),
        )
    await db.rollback()

    assert await db.scalar(
        select(func.count())
        .select_from(ClientWriteRequest)
        .where(
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == import_svc.SCOPE,
        )
    ) == 1
    second = await db.get(Stage, second_id, populate_existing=True)
    assert second is not None and second.planned_start is None


@pytest.mark.asyncio
async def test_calendar_import_failure_rolls_back_all_stage_changes_and_ledger(db, monkeypatch):
    user_id, project_id, first_id, second_id = await _seed(db)

    async def fail_before_commit(*_args, **_kwargs):
        raise RuntimeError("synthetic_before_commit")

    monkeypatch.setattr(import_svc, "commit_client_write", fail_before_commit)

    with pytest.raises(RuntimeError, match="synthetic_before_commit"):
        await import_svc.import_ical(
            db,
            project_id=project_id,
            user_id=user_id,
            client_request_id="calendar-import-rollback-001",
            content="\n".join(
                [
                    "BEGIN:VCALENDAR",
                    "BEGIN:VEVENT",
                    "UID:external-a",
                    "SUMMARY:External A",
                    "DTSTART;VALUE=DATE:20261001",
                    "END:VEVENT",
                    "BEGIN:VEVENT",
                    "UID:external-b",
                    "SUMMARY:External B",
                    "DTSTART;VALUE=DATE:20261002",
                    "END:VEVENT",
                    "END:VCALENDAR",
                ]
            ),
        )

    first = await db.get(Stage, first_id, populate_existing=True)
    second = await db.get(Stage, second_id, populate_existing=True)
    assert first is not None and second is not None
    assert first.planned_start is None and first.ical_uid is None
    assert second.planned_start is None and second.ical_uid is None
    assert await db.scalar(
        select(func.count())
        .select_from(ClientWriteRequest)
        .where(
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == import_svc.SCOPE,
        )
    ) == 0
