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


def _ics_without_uid(*, summary: str = "External event", ymd: str = "20261003") -> str:
    return "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "BEGIN:VEVENT",
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
async def test_calendar_import_uidless_event_preserves_local_ical_uid(db):
    user_id, project_id, first_id, second_id = await _seed(db)
    content = _ics_without_uid()
    request_id = "calendar-import-uidless-001"

    result, replayed = await import_svc.import_ical(
        db,
        project_id=project_id,
        user_id=user_id,
        client_request_id=request_id,
        content=content,
    )
    assert replayed is False
    assert result == {"ok": True, "parsed": 1, "updated_stages": 1}

    first = await db.get(Stage, first_id, populate_existing=True)
    second = await db.get(Stage, second_id, populate_existing=True)
    assert first is not None and second is not None
    assert first.planned_start == date(2026, 10, 3)
    assert first.planned_end == date(2026, 10, 3)
    assert first.ical_uid == f"renova-{first_id}@app"
    assert second.planned_start is None and second.ical_uid is None

    replay_result, replayed = await import_svc.import_ical(
        db,
        project_id=project_id,
        user_id=user_id,
        client_request_id=request_id,
        content=content.replace("\r\n", "\n"),
    )
    assert replayed is True
    assert replay_result == result
    first = await db.get(Stage, first_id, populate_existing=True)
    second = await db.get(Stage, second_id, populate_existing=True)
    assert first is not None and first.ical_uid == f"renova-{first_id}@app"
    assert second is not None and second.planned_start is None


@pytest.mark.asyncio
async def test_calendar_import_failure_rolls_back_all_stage_changes_and_ledger(db, monkeypatch):
    user_id, project_id, first_id, second_id = await _seed(db)
    original_commit_client_write = import_svc.commit_client_write
    request_id = "calendar-import-rollback-001"
    content = "\n".join(
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
    )

    async def fail_after_stage_flush(db_arg, *_args, **_kwargs):
        # Force the dirty Stage rows through real SQL UPDATE statements inside
        # the still-open transaction, then fail before the request ledger can
        # commit. This proves database rollback, not merely ORM state discard.
        await db_arg.flush()
        raise RuntimeError("synthetic_after_stage_flush")

    monkeypatch.setattr(import_svc, "commit_client_write", fail_after_stage_flush)

    with pytest.raises(RuntimeError, match="synthetic_after_stage_flush"):
        await import_svc.import_ical(
            db,
            project_id=project_id,
            user_id=user_id,
            client_request_id=request_id,
            content=content,
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

    # Recovery must be retryable with the exact same logical intent after the
    # transient post-flush/pre-commit failure. Zero residual rows alone are not
    # sufficient proof if the same request cannot subsequently complete once.
    monkeypatch.setattr(import_svc, "commit_client_write", original_commit_client_write)
    retry_result, replayed = await import_svc.import_ical(
        db,
        project_id=project_id,
        user_id=user_id,
        client_request_id=request_id,
        content=content,
    )
    assert replayed is False
    assert retry_result == {"ok": True, "parsed": 2, "updated_stages": 2}

    first = await db.get(Stage, first_id, populate_existing=True)
    second = await db.get(Stage, second_id, populate_existing=True)
    assert first is not None and second is not None
    assert first.planned_start == date(2026, 10, 1)
    assert first.ical_uid == "external-a"
    assert second.planned_start == date(2026, 10, 2)
    assert second.ical_uid == "external-b"
    assert await db.scalar(
        select(func.count())
        .select_from(ClientWriteRequest)
        .where(
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == import_svc.SCOPE,
            ClientWriteRequest.request_id == request_id,
        )
    ) == 1
