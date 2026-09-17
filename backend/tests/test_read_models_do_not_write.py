"""Opening a screen must not change what it shows.

`build_work_snapshot` is a read model behind `GET
/projects/{id}/stages/{id}/snapshot`, declared with `write=False`. It did two
things a read must not do:

    stage.percent_complete = float(prog)          # overwrite recorded progress
    blocked = await dep_svc.evaluate_stage(db, stage)   # commit=True by default

So simply opening a stage card overwrote the contractor's recorded progress
with the checklist ratio and committed it. Observed live: a stage marked 90%
and waiting for acceptance became 0% on a GET, and the project's progress fell
with it.

`evaluate_stage` says so in its own docstring — "``persist_status=False``
используется в GET/read-model путях" — and `stages_ext.stage_blocked` passes
both flags correctly. Five other callers did not: the two here, plus the room
card, the insights engine and the risk engine.

`completion_check` is the subtle one. It is a *check*, called from the GET
route, from the room card, and from two mutation gates. A check has no business
writing in any of those, and while it did, the `rollback()` after a failed
acceptance gate in `stage_review_service` had nothing left to roll back.

The suite did not catch this because nothing asserted the absence of a write.
These tests read the row back after the call.
"""

from __future__ import annotations

import json

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
    WorkDependency,
)
from app.services import project_service as proj_svc
from app.services import stage_service as stage_svc
from app.services import work_snapshot_service as ws

RECORDED_PROGRESS = 90.0


@pytest_asyncio.fixture
async def read_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed(db, suffix: str) -> tuple[str, str]:
    customer = User(id=f"ro-customer-{suffix}", phone=f"+7933{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"ro-contractor-{suffix}", phone=f"+7944{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"ro-project-{suffix}",
        name="Read model",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id=f"ro-stage-{suffix}",
        project_id=project.id,
        name="Подготовка",
        sort_order=1,
        status=StageStatus.review,
        # Recorded by the contractor, and nothing about opening a screen should
        # disagree with it.
        percent_complete=RECORDED_PROGRESS,
        # A checklist with nothing ticked, so the ratio the snapshot computes
        # (0%) is as far from the recorded value as it can be.
        checklist_json=json.dumps(
            [{"id": "c0", "text": "Защита зон", "done": False},
             {"id": "c1", "text": "Вынос мусора", "done": False}],
            ensure_ascii=False,
        ),
    )
    # A satisfied predecessor, so `evaluate_stage` has a dependency row whose
    # status it would rewrite. Without one, persist_status=True writes nothing
    # observable and the test would pass either way.
    done_before = Stage(
        id=f"ro-stage-before-{suffix}",
        project_id=project.id,
        name="Демонтаж",
        sort_order=0,
        status=StageStatus.done,
        percent_complete=100,
    )
    dependency = WorkDependency(
        id=f"ro-dep-{suffix}",
        project_id=project.id,
        stage_id=stage.id,
        depends_on_stage_id=done_before.id,
        dependency_type="work",
        criticality="high",
        # Stale on purpose: the predecessor is done, so a persisting evaluation
        # would move this to "satisfied".
        status="pending",
    )
    db.add_all([customer, contractor, project, done_before, stage, dependency])
    await db.commit()
    return project.id, stage.id


async def _fresh_stage(db, stage_id: str) -> Stage:
    """Read the stage back as a new request would see it."""
    db.expire_all()
    return (
        await db.execute(select(Stage).where(Stage.id == stage_id))
    ).scalars().one()


async def _as_the_route_loads_them(db, project_id: str, stage_id: str):
    """The same loaders the GET route uses, so relationships are populated."""
    db.expire_all()
    project = await proj_svc.get_project(db, project_id)
    stage = await stage_svc.get_stage_full(db, stage_id)
    return project, stage


@pytest.mark.asyncio
async def test_opening_a_stage_card_does_not_rewrite_its_progress(read_db):
    project_id, stage_id = await _seed(read_db, "snapshot")

    project, stage = await _as_the_route_loads_them(read_db, project_id, stage_id)

    await ws.build_work_snapshot(read_db, stage, project, role="customer")

    stored = await _fresh_stage(read_db, stage_id)
    assert stored.percent_complete == RECORDED_PROGRESS, (
        "a GET overwrote the stage's recorded progress with the checklist ratio"
    )


@pytest.mark.asyncio
async def test_the_snapshot_still_reports_the_checklist_ratio(read_db):
    """Guards the guard: the fix must not have changed the response.

    The snapshot has always returned the locally computed ratio, not the stored
    column, so removing the assignment changes nothing a client can see.
    """
    project_id, stage_id = await _seed(read_db, "response")

    project, stage = await _as_the_route_loads_them(read_db, project_id, stage_id)

    snapshot = await ws.build_work_snapshot(read_db, stage, project, role="customer")

    assert snapshot["percent_complete"] == 0, (
        "nothing is ticked, so the snapshot reports 0 — while the stage keeps 90"
    )
    assert snapshot["id"] == stage_id


@pytest.mark.asyncio
async def test_opening_a_stage_card_does_not_persist_dependency_status(read_db):
    """The second write: `evaluate_stage` defaults to commit=True.

    Its own docstring reserves that for mutation lifecycles and tells read
    models to pass `persist_status=False`.
    """
    project_id, stage_id = await _seed(read_db, "deps")

    project, stage = await _as_the_route_loads_them(read_db, project_id, stage_id)

    await ws.build_work_snapshot(read_db, stage, project, role="customer")

    read_db.expire_all()
    stored = (
        await read_db.execute(
            select(WorkDependency).where(WorkDependency.stage_id == stage_id)
        )
    ).scalars().one()
    assert stored.status == "pending", (
        "a GET rewrote and committed the dependency status"
    )


@pytest.mark.asyncio
async def test_the_completion_check_does_not_write(read_db):
    """It is called from a GET route and from two mutation gates alike."""
    project_id, stage_id = await _seed(read_db, "gate")

    project, stage = await _as_the_route_loads_them(read_db, project_id, stage_id)

    result = await ws.completion_check(read_db, stage, project)

    assert "ok" in result
    stored = await _fresh_stage(read_db, stage_id)
    assert stored.percent_complete == RECORDED_PROGRESS
