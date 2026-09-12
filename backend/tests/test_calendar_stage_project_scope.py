from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException

from app.api.v1.calendar import StageDatesUpdate, update_stage_dates as calendar_update_stage_dates
from app.models.entities import Project, Stage, StageStatus, User, UserRole


async def _seed_two_projects(db):
    customer_a = User(
        id="calendar-scope-customer-a",
        phone="+79000001001",
        role=UserRole.customer,
    )
    contractor_a = User(
        id="calendar-scope-contractor-a",
        phone="+79000001002",
        role=UserRole.contractor,
    )
    customer_b = User(
        id="calendar-scope-customer-b",
        phone="+79000001003",
        role=UserRole.customer,
    )
    contractor_b = User(
        id="calendar-scope-contractor-b",
        phone="+79000001004",
        role=UserRole.contractor,
    )
    project_a = Project(
        id="calendar-scope-project-a",
        name="Project A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor_a.id,
    )
    project_b = Project(
        id="calendar-scope-project-b",
        name="Project B",
        renovation_type="cosmetic",
        customer_id=customer_b.id,
        contractor_id=contractor_b.id,
    )
    stage_a = Stage(
        id="calendar-scope-stage-a",
        project_id=project_a.id,
        name="Stage A",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 9, 10),
        planned_end=date(2026, 9, 12),
    )
    stage_b = Stage(
        id="calendar-scope-stage-b",
        project_id=project_b.id,
        name="Stage B",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 10, 1),
        planned_end=date(2026, 10, 3),
    )
    db.add_all(
        [
            customer_a,
            contractor_a,
            customer_b,
            contractor_b,
            project_a,
            project_b,
            stage_a,
            stage_b,
        ]
    )
    await db.commit()
    return contractor_a, project_a, stage_a, stage_b


@pytest.mark.asyncio
async def test_authorized_project_cannot_commit_dates_to_foreign_stage(db):
    contractor_a, project_a, _stage_a, stage_b = await _seed_two_projects(db)
    original_start = stage_b.planned_start
    original_end = stage_b.planned_end
    assert stage_b.ical_uid is None

    with pytest.raises(HTTPException) as error:
        await calendar_update_stage_dates(
            project_a.id,
            StageDatesUpdate(
                stage_id=stage_b.id,
                planned_start=date(2027, 1, 1),
                planned_end=date(2027, 1, 2),
            ),
            contractor_a,
            db,
        )
    assert error.value.status_code == 404

    # End the failed request transaction and force a fresh database read. The
    # security contract is about committed truth, not the API response code.
    await db.rollback()
    db.expire_all()
    persisted = await db.get(Stage, stage_b.id)
    assert persisted is not None
    assert persisted.planned_start == original_start
    assert persisted.planned_end == original_end
    assert persisted.ical_uid is None


@pytest.mark.asyncio
async def test_authorized_project_stage_date_update_still_commits(db):
    contractor_a, project_a, stage_a, _stage_b = await _seed_two_projects(db)

    response = await calendar_update_stage_dates(
        project_a.id,
        StageDatesUpdate(
            stage_id=stage_a.id,
            planned_start=date(2026, 11, 1),
            planned_end=date(2026, 11, 5),
        ),
        contractor_a,
        db,
    )
    assert response["events"]

    db.expire_all()
    persisted = await db.get(Stage, stage_a.id)
    assert persisted is not None
    assert persisted.planned_start == date(2026, 11, 1)
    assert persisted.planned_end == date(2026, 11, 5)
    assert persisted.ical_uid == f"renova-{stage_a.id}@app"
