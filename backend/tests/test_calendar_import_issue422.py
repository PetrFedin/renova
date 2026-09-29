"""Issue #422 — atomic, response-loss-safe .ics import with correct DTEND.

Covers:
  - DTSTART/DTEND are both parsed; a multi-day event keeps its real end date
    (the prior parser silently dropped DTEND and collapsed every event to a
    single day).
  - A byte-identical retry (response-loss replay) returns the original
    result and does not shift the mapping onto a different fallback stage.
  - A caller-supplied client_request_id reused with different content is
    rejected as a conflict instead of silently reapplying a new mapping.
  - A synthetic failure before commit leaves all target stages unchanged and
    writes no ledger/result rows (rollback is all-or-nothing across the
    whole file, not per event).
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.client_write_request import ClientWriteRequest
from app.models.calendar_import import IcalImportResult
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.services import calendar_import_service as import_svc
from app.services.client_write_idempotency import IdempotencyConflict


async def seed_project(db, suffix: str, *, stage_count: int = 2):
    tail = sum((i + 1) * ord(c) for i, c in enumerate(suffix)) % 10_000_000
    customer = User(id=f"ical-customer-{suffix}", phone=f"+7900{tail:07d}", role=UserRole.customer)
    contractor = User(id=f"ical-contractor-{suffix}", phone=f"+7901{tail:07d}", role=UserRole.contractor)
    project = Project(
        id=f"ical-project-{suffix}",
        name="Import project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stages = [
        Stage(
            id=f"ical-stage-{suffix}-{i}",
            project_id=project.id,
            name=f"Этап {i}",
            sort_order=i,
            status=StageStatus.planned,
            percent_complete=0,
        )
        for i in range(stage_count)
    ]
    db.add_all([customer, contractor, project, *stages])
    await db.commit()
    return {
        "project_id": project.id,
        "contractor_id": contractor.id,
        "stage_ids": [s.id for s in stages],
    }


def build_ics(events: list[dict]) -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN"]
    for ev in events:
        lines.append("BEGIN:VEVENT")
        if ev.get("uid"):
            lines.append(f"UID:{ev['uid']}")
        lines.append(f"SUMMARY:{ev.get('title', 'Event')}")
        lines.append(f"DTSTART;VALUE=DATE:{ev['start']}")
        if ev.get("end_exclusive"):
            lines.append(f"DTEND;VALUE=DATE:{ev['end_exclusive']}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


@pytest.mark.asyncio
async def test_dtend_is_parsed_and_stage_keeps_real_span(db):
    graph = await seed_project(db, "dtend", stage_count=1)
    stage_id = graph["stage_ids"][0]
    # 5-day event: DTSTART 2026-10-01, DTEND(exclusive) 2026-10-06 -> inclusive end 2026-10-05
    ics = build_ics([
        {"uid": f"uid-{stage_id}", "title": "Этап 0", "start": "20261001", "end_exclusive": "20261006"},
    ])

    result = await import_svc.import_ical_atomic(
        db, project_id=graph["project_id"], actor_id=graph["contractor_id"], content=ics,
    )
    assert result == {"ok": True, "parsed": 1, "updated_stages": 1, "replayed": False}

    stage = await db.get(Stage, stage_id)
    assert stage.planned_start == date(2026, 10, 1)
    assert stage.planned_end == date(2026, 10, 5)  # not collapsed to DTSTART only


@pytest.mark.asyncio
async def test_missing_dtend_falls_back_to_single_day(db):
    graph = await seed_project(db, "nodtend", stage_count=1)
    stage_id = graph["stage_ids"][0]
    ics = build_ics([{"uid": f"uid-{stage_id}", "title": "Этап 0", "start": "20261010"}])

    result = await import_svc.import_ical_atomic(
        db, project_id=graph["project_id"], actor_id=graph["contractor_id"], content=ics,
    )
    assert result["updated_stages"] == 1
    stage = await db.get(Stage, stage_id)
    assert stage.planned_start == date(2026, 10, 10)
    assert stage.planned_end == date(2026, 10, 10)


@pytest.mark.asyncio
async def test_identical_replay_does_not_duplicate_or_drift_mapping(db):
    graph = await seed_project(db, "replay", stage_count=2)
    ics = build_ics([{"title": "Unmatched event", "start": "20261101"}])

    first = await import_svc.import_ical_atomic(
        db, project_id=graph["project_id"], actor_id=graph["contractor_id"], content=ics,
    )
    assert first["replayed"] is False
    assert first["updated_stages"] == 1

    stage_a, stage_b = graph["stage_ids"]
    a = await db.get(Stage, stage_a)
    b = await db.get(Stage, stage_b)
    # exactly one of the two empty stages was claimed by the fallback match
    claimed = [s for s in (a, b) if s.planned_start is not None]
    assert len(claimed) == 1
    first_claimed_id = claimed[0].id

    # Simulate response loss: client resends the identical file.
    second = await import_svc.import_ical_atomic(
        db, project_id=graph["project_id"], actor_id=graph["contractor_id"], content=ics,
    )
    assert second == {**first, "replayed": True}

    a = await db.get(Stage, stage_a)
    b = await db.get(Stage, stage_b)
    claimed_after = [s for s in (a, b) if s.planned_start is not None]
    assert len(claimed_after) == 1
    assert claimed_after[0].id == first_claimed_id  # no drift onto the other stage

    assert await db.scalar(select(func.count()).select_from(IcalImportResult)) == 1
    assert await db.scalar(
        select(func.count()).select_from(ClientWriteRequest).where(
            ClientWriteRequest.scope == import_svc.CALENDAR_IMPORT_SCOPE
        )
    ) == 1


@pytest.mark.asyncio
async def test_explicit_client_request_id_replay_and_conflict(db):
    graph = await seed_project(db, "crid", stage_count=1)
    stage_id = graph["stage_ids"][0]
    ics_v1 = build_ics([{"uid": f"uid-{stage_id}", "start": "20261201"}])
    ics_v2 = build_ics([{"uid": f"uid-{stage_id}", "start": "20261202"}])

    first = await import_svc.import_ical_atomic(
        db, project_id=graph["project_id"], actor_id=graph["contractor_id"],
        content=ics_v1, client_request_id="mobile-req-1",
    )
    assert first["replayed"] is False

    replay = await import_svc.import_ical_atomic(
        db, project_id=graph["project_id"], actor_id=graph["contractor_id"],
        content=ics_v1, client_request_id="mobile-req-1",
    )
    assert replay["replayed"] is True
    assert replay["parsed"] == first["parsed"]

    with pytest.raises(IdempotencyConflict):
        await import_svc.import_ical_atomic(
            db, project_id=graph["project_id"], actor_id=graph["contractor_id"],
            content=ics_v2, client_request_id="mobile-req-1",
        )


@pytest.mark.asyncio
async def test_synthetic_failure_before_commit_leaves_stages_and_ledger_untouched(db, monkeypatch):
    graph = await seed_project(db, "rollback", stage_count=1)
    stage_id = graph["stage_ids"][0]
    ics = build_ics([{"uid": f"uid-{stage_id}", "start": "20261225", "end_exclusive": "20261228"}])

    original_commit = db.commit

    async def fail_commit():
        raise RuntimeError("synthetic_ical_import_commit_failure")

    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="synthetic_ical_import_commit_failure"):
        await import_svc.import_ical_atomic(
            db, project_id=graph["project_id"], actor_id=graph["contractor_id"], content=ics,
        )
    monkeypatch.setattr(db, "commit", original_commit)

    stage = await db.get(Stage, stage_id)
    assert stage.planned_start is None
    assert stage.planned_end is None
    assert await db.scalar(select(func.count()).select_from(IcalImportResult)) == 0
    assert await db.scalar(select(func.count()).select_from(ClientWriteRequest)) == 0


@pytest.mark.asyncio
async def test_two_unmatched_events_in_one_file_claim_distinct_fallback_stages(db):
    graph = await seed_project(db, "twofallback", stage_count=2)
    ics = build_ics([
        {"title": "First unmatched", "start": "20270101"},
        {"title": "Second unmatched", "start": "20270102"},
    ])

    result = await import_svc.import_ical_atomic(
        db, project_id=graph["project_id"], actor_id=graph["contractor_id"], content=ics,
    )
    assert result["updated_stages"] == 2

    stages = [await db.get(Stage, sid) for sid in graph["stage_ids"]]
    starts = sorted(s.planned_start for s in stages)
    assert starts == [date(2027, 1, 1), date(2027, 1, 2)]
