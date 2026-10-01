"""Issue #421: calendar stage-date mutation must be scoped to the path project
before any commit.

Regression coverage for the IDOR where PATCH /projects/{project_id}/calendar/stages
authorized only the URL project_id, then called stage_service.update_stage_dates()
with the unscoped stage_id. That service loaded Stage by id alone, mutated
planned_start/planned_end/ical_uid, and committed - all before the route's
after-the-fact `stage.project_id != project_id` check. A contractor authorized to
Project A could supply a Stage id belonging to Project B: Project B's stage got
mutated and committed, and only then did the route return 404 - too late to undo
the write.

The fix binds the mutation to (Stage.id == stage_id AND Stage.project_id ==
project_id) inside the same query that loads the stage, before any assignment or
commit, so a cross-project id simply matches no row and nothing is written.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.services import stage_service as stage_svc


async def _seed(db, suffix: str):
    customer_a = User(id=f"cust-a-{suffix}", phone=f"+7900001{suffix}1", role=UserRole.customer)
    contractor_a = User(id=f"contr-a-{suffix}", phone=f"+7900001{suffix}2", role=UserRole.contractor)
    customer_b = User(id=f"cust-b-{suffix}", phone=f"+7900001{suffix}3", role=UserRole.customer)
    contractor_b = User(id=f"contr-b-{suffix}", phone=f"+7900001{suffix}4", role=UserRole.contractor)

    project_a = Project(
        id=f"proj-a-{suffix}",
        name="Project A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor_a.id,
    )
    project_b = Project(
        id=f"proj-b-{suffix}",
        name="Project B",
        renovation_type="cosmetic",
        customer_id=customer_b.id,
        contractor_id=contractor_b.id,
    )
    stage_a = Stage(
        id=f"stage-a-{suffix}",
        project_id=project_a.id,
        name="Stage A",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
    )
    stage_b = Stage(
        id=f"stage-b-{suffix}",
        project_id=project_b.id,
        name="Stage B",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=None,
        planned_end=None,
    )
    db.add_all([customer_a, contractor_a, customer_b, contractor_b, project_a, project_b, stage_a, stage_b])
    await db.commit()
    return {
        "contractor_a": contractor_a,
        "project_a": project_a,
        "project_b": project_b,
        "stage_a": stage_a,
        "stage_b": stage_b,
    }


def _override(db, user):
    async def _db():
        yield db

    async def _user():
        return user

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user


@pytest.mark.asyncio
async def test_patch_calendar_stages_rejects_foreign_stage_and_leaves_it_untouched(db):
    """Contractor authorized only to Project A cannot mutate Project B's stage dates
    by pairing Project A's URL with Project B's stage id, and no write survives."""
    g = await _seed(db, "w421a")
    stage_b_id = g["stage_b"].id  # the canonical path rolls back on 404 and expires ORM instances
    project_a_id = g["project_a"].id
    _override(db, g["contractor_a"])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.patch(
                f"/api/v1/projects/{project_a_id}/calendar/stages",
                json={
                    "stage_id": stage_b_id,
                    "planned_start": "2026-10-01",
                    "planned_end": "2026-10-05",
                },
            )
            assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.clear()

    # Reload from a fresh session/query to prove nothing was committed for Stage B.
    from sqlalchemy import select

    refreshed = (
        await db.execute(select(Stage).where(Stage.id == stage_b_id))
    ).scalar_one()
    assert refreshed.planned_start is None
    assert refreshed.planned_end is None
    assert refreshed.ical_uid is None


@pytest.mark.asyncio
async def test_patch_calendar_stages_updates_own_project_stage(db):
    """Positive path: an authorized contractor can still update their own project's
    stage dates through the same endpoint."""
    g = await _seed(db, "w421b")
    _override(db, g["contractor_a"])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.patch(
                f"/api/v1/projects/{g['project_a'].id}/calendar/stages",
                json={
                    "stage_id": g["stage_a"].id,
                    "planned_start": "2026-10-01",
                    "planned_end": "2026-10-05",
                },
            )
            assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.clear()

    from sqlalchemy import select

    refreshed = (
        await db.execute(select(Stage).where(Stage.id == g["stage_a"].id))
    ).scalar_one()
    assert refreshed.planned_start.isoformat() == "2026-10-01"
    assert refreshed.planned_end.isoformat() == "2026-10-05"


@pytest.mark.asyncio
async def test_service_update_stage_dates_requires_matching_project_id(db):
    """Unit-level: the scoped service contract itself must refuse a stage id that
    belongs to a different project, without committing anything."""
    g = await _seed(db, "w421c")

    result = await stage_svc.update_stage_dates(
        db, g["project_a"].id, g["stage_b"].id, None, None
    )
    assert result is None

    from sqlalchemy import select

    refreshed = (
        await db.execute(select(Stage).where(Stage.id == g["stage_b"].id))
    ).scalar_one()
    assert refreshed.ical_uid is None
