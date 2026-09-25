"""build_calendar must give each stage sub-event (period/started/ready/accepted)
its own UID. Before this fix all three timestamped sub-events for a stage
(actual_start/contractor_ready_at/customer_accepted_at) shared one UID with
the stage's period event, so /calendar.ics silently collapsed up to 4 distinct
VEVENTs into 1 in any real calendar client (Google/Apple treat same-UID as
revisions of one event and keep only the last).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.services.calendar_service import build_calendar


def _stage(**overrides):
    base = dict(
        id="stage-1",
        name="Демонтаж",
        sort_order=0,
        planned_start=date(2026, 9, 1),
        planned_end=date(2026, 9, 5),
        actual_start=datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc),
        contractor_ready_at=datetime(2026, 9, 4, 18, 0, tzinfo=timezone.utc),
        customer_accepted_at=datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc),
        status=SimpleNamespace(value="accepted"),
        ical_uid=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _project(**overrides):
    base = dict(
        id="project-1",
        planned_start_date=None,
        planned_end_date=None,
        stages=[],
        payments=[],
        work_orders=[],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_stage_with_all_milestones_gets_four_distinct_uids():
    project = _project(stages=[_stage()])

    data = build_calendar(project)

    stage_events = [e for e in data["events"] if e.get("stage_id") == "stage-1"]
    uids = [e["uid"] for e in stage_events if "uid" in e]

    # period + started + ready + accepted == 4 events for this one stage.
    assert len(stage_events) == 4
    # Regression guard: every UID must be unique — a duplicate here means a
    # real calendar import will silently drop events again.
    assert len(uids) == len(set(uids)), f"duplicate UIDs across stage events: {uids}"

    # Each synthetic UID must still be traceable to its stage.
    for uid in uids:
        assert "stage-1" in uid, uid


def test_explicit_ical_uid_only_applies_to_the_period_event():
    project = _project(stages=[_stage(ical_uid="external-calendar-uid-123")])

    data = build_calendar(project)
    stage_events = [e for e in data["events"] if e.get("stage_id") == "stage-1"]
    by_kind = {e["kind"]: e["uid"] for e in stage_events}

    assert by_kind["stage_period"] == "external-calendar-uid-123"
    # Sub-events must NOT collapse onto the imported external UID either.
    assert by_kind["stage_started"] != by_kind["stage_period"]
    assert by_kind["contractor_ready"] != by_kind["stage_period"]
    assert by_kind["customer_accepted"] != by_kind["stage_period"]
    assert len({by_kind["stage_started"], by_kind["contractor_ready"], by_kind["customer_accepted"], by_kind["stage_period"]}) == 4
