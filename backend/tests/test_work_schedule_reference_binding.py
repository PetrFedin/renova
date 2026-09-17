from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1 import project_work_schedule as api
from app.models.entities import Project, Stage, User, UserRole
from app.models.work_schedule import ProjectWorkSchedule, ProjectWorkScheduleItem
from app.schemas.project_work_schedule import WorkScheduleCreateIn, WorkScheduleItemIn, WorkScheduleUpdateIn


def _item(*, title: str, stage_id: str | None = None, depends_on_item_id: str | None = None) -> WorkScheduleItemIn:
    return WorkScheduleItemIn(
        stage_id=stage_id,
        title=title,
        planned_start_date=date(2026, 9, 20),
        planned_finish_date=date(2026, 9, 22),
        depends_on_item_id=depends_on_item_id,
    )


async def _seed(db):
    contractor = User(id="schedule-ref-contractor", phone="+79990004810", role=UserRole.contractor)
    customer = User(id="schedule-ref-customer", phone="+79990004811", role=UserRole.customer)
    db.add_all([contractor, customer])
    await db.flush()

    project_a = Project(
        id="schedule-ref-project-a",
        name="Schedule A",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    project_b = Project(
        id="schedule-ref-project-b",
        name="Schedule B",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([project_a, project_b])
    await db.flush()

    stage_a = Stage(id="schedule-ref-stage-a", project_id=project_a.id, name="Stage A")
    stage_b = Stage(id="schedule-ref-stage-b", project_id=project_b.id, name="Stage B")
    db.add_all([stage_a, stage_b])
    await db.flush()

    schedule_a = ProjectWorkSchedule(
        id="schedule-ref-a",
        project_id=project_a.id,
        title="Original A",
        created_by=contractor.id,
    )
    schedule_b = ProjectWorkSchedule(
        id="schedule-ref-b",
        project_id=project_b.id,
        title="Original B",
        created_by=contractor.id,
    )
    db.add_all([schedule_a, schedule_b])
    await db.flush()

    item_a = ProjectWorkScheduleItem(
        id="schedule-ref-item-a",
        schedule_id=schedule_a.id,
        project_id=project_a.id,
        stage_id=stage_a.id,
        title="Original item A",
        planned_start_date=date(2026, 9, 18),
        planned_finish_date=date(2026, 9, 19),
    )
    item_b = ProjectWorkScheduleItem(
        id="schedule-ref-item-b",
        schedule_id=schedule_b.id,
        project_id=project_b.id,
        stage_id=stage_b.id,
        title="Original item B",
        planned_start_date=date(2026, 9, 18),
        planned_finish_date=date(2026, 9, 19),
    )
    db.add_all([item_a, item_b])
    await db.commit()
    return contractor, project_a, project_b, stage_a, stage_b, schedule_a, schedule_b, item_a, item_b


@pytest.mark.asyncio
async def test_schedule_create_rejects_foreign_stage_before_schedule_persistence(db):
    contractor, project_a, _, _, stage_b, *_ = await _seed(db)

    with pytest.raises(HTTPException) as rejected:
        await api.create_project_work_schedule(
            project_a.id,
            WorkScheduleCreateIn(title="Foreign stage", items=[_item(title="Foreign", stage_id=stage_b.id)]),
            db=db,
            user=contractor,
        )
    assert rejected.value.status_code == 404

    created = (
        await db.execute(
            select(ProjectWorkSchedule).where(
                ProjectWorkSchedule.project_id == project_a.id,
                ProjectWorkSchedule.title == "Foreign stage",
            )
        )
    ).scalar_one_or_none()
    assert created is None


@pytest.mark.asyncio
async def test_schedule_replace_rejects_foreign_stage_and_dependency_without_destroying_original(db):
    contractor, project_a, _, stage_a, stage_b, schedule_a, _, item_a, item_b = await _seed(db)

    with pytest.raises(HTTPException) as foreign_stage:
        await api.update_project_work_schedule(
            project_a.id,
            schedule_a.id,
            WorkScheduleUpdateIn(items=[_item(title="Foreign stage", stage_id=stage_b.id)]),
            db=db,
            user=contractor,
        )
    assert foreign_stage.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_dependency:
        await api.update_project_work_schedule(
            project_a.id,
            schedule_a.id,
            WorkScheduleUpdateIn(
                items=[_item(title="Foreign dep", stage_id=stage_a.id, depends_on_item_id=item_b.id)]
            ),
            db=db,
            user=contractor,
        )
    assert foreign_dependency.value.status_code == 404

    with pytest.raises(HTTPException) as unstable_same_schedule_dependency:
        await api.update_project_work_schedule(
            project_a.id,
            schedule_a.id,
            WorkScheduleUpdateIn(
                items=[_item(title="Old-id dep", stage_id=stage_a.id, depends_on_item_id=item_a.id)]
            ),
            db=db,
            user=contractor,
        )
    assert unstable_same_schedule_dependency.value.status_code == 422
    assert unstable_same_schedule_dependency.value.detail == "work_schedule_dependency_replace_not_supported"

    remaining = list(
        (
            await db.execute(
                select(ProjectWorkScheduleItem).where(ProjectWorkScheduleItem.schedule_id == schedule_a.id)
            )
        ).scalars().all()
    )
    assert [(row.id, row.title, row.stage_id) for row in remaining] == [
        (item_a.id, "Original item A", stage_a.id)
    ]


@pytest.mark.asyncio
async def test_schedule_same_project_replacement_and_metadata_update_remain_valid(db):
    contractor, project_a, _, stage_a, _, schedule_a, _, item_a, _ = await _seed(db)

    replaced = await api.update_project_work_schedule(
        project_a.id,
        schedule_a.id,
        WorkScheduleUpdateIn(items=[_item(title="Replacement A", stage_id=stage_a.id)]),
        db=db,
        user=contractor,
    )
    assert len(replaced.items) == 1
    assert replaced.items[0].stage_id == stage_a.id
    assert replaced.items[0].depends_on_item_id is None

    updated = await api.update_project_work_schedule(
        project_a.id,
        schedule_a.id,
        WorkScheduleUpdateIn(title="Metadata only"),
        db=db,
        user=contractor,
    )
    assert updated.title == "Metadata only"
    assert len(updated.items) == 1
