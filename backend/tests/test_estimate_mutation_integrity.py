"""P0 mutation integrity for estimate lines and material facts."""

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.estimate import LinePatch, delete_line, patch_line
from app.core.timeutil import utc_now
from app.models.entities import (
    BudgetLine,
    EstimateLine,
    LineType,
    Project,
    User,
    UserRole,
)
from app.services.budget_service import sync_budget_lines_from_estimate, sync_project_budget_planned
from app.services.estimate_service import material_stats

pytestmark = pytest.mark.asyncio


async def _participants(db):
    customer = User(phone="+79990001001", role=UserRole.customer, full_name="P0 Customer")
    contractor = User(phone="+79990001002", role=UserRole.contractor, full_name="P0 Contractor")
    db.add_all([customer, contractor])
    await db.flush()
    return customer, contractor


async def _project(db, customer: User, contractor: User, name: str) -> Project:
    project = Project(
        name=name,
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add(project)
    await db.flush()
    return project


async def _line(db, project: Project, *, price: float = 1000, qty: float = 2) -> EstimateLine:
    line = EstimateLine(
        project_id=project.id,
        line_type=LineType.material,
        name=f"Material {project.name}",
        unit="pcs",
        quantity_planned=qty,
        quantity_actual=0,
        unit_price=price,
    )
    db.add(line)
    await db.flush()
    return line


async def test_patch_estimate_line_is_project_scoped(db):
    customer, contractor = await _participants(db)
    project_a = await _project(db, customer, contractor, "Project A")
    project_b = await _project(db, customer, contractor, "Project B")
    line_b = await _line(db, project_b, price=1200)
    await db.commit()

    with pytest.raises(HTTPException) as exc_info:
        await patch_line(
            project_a.id,
            line_b.id,
            LinePatch(unit_price=9999),
            contractor,
            db,
        )

    assert exc_info.value.status_code == 404
    persisted = await db.get(EstimateLine, line_b.id)
    assert persisted is not None
    assert persisted.unit_price == 1200


async def test_delete_draft_estimate_line_repairs_budget_and_projection(db):
    customer, contractor = await _participants(db)
    project = await _project(db, customer, contractor, "Delete draft")
    line = await _line(db, project, price=1000, qty=2)
    await db.flush()
    await sync_budget_lines_from_estimate(db, project.id)
    await sync_project_budget_planned(db, project.id)
    await db.commit()

    project_before = await db.get(Project, project.id)
    assert project_before is not None
    assert project_before.budget_planned == 2000
    projection_before = await db.scalar(
        select(BudgetLine).where(BudgetLine.estimate_line_id == line.id)
    )
    assert projection_before is not None

    result = await delete_line(project.id, line.id, contractor, db)
    assert result["ok"] is True
    assert result["budget_planned"] == 0

    assert await db.get(EstimateLine, line.id) is None
    projection_after = await db.scalar(
        select(BudgetLine).where(BudgetLine.estimate_line_id == line.id)
    )
    assert projection_after is None
    project_after = await db.get(Project, project.id)
    await db.refresh(project_after)
    assert project_after.budget_planned == 0


async def test_delete_estimate_line_is_blocked_after_lock(db):
    customer, contractor = await _participants(db)
    project = await _project(db, customer, contractor, "Locked estimate")
    line = await _line(db, project)
    project.estimate_locked_at = utc_now()
    await db.commit()

    with pytest.raises(HTTPException) as exc_info:
        await delete_line(project.id, line.id, contractor, db)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "estimate_locked"
    assert await db.get(EstimateLine, line.id) is not None


async def test_material_stats_treat_zero_actual_as_observed_zero():
    line = EstimateLine(
        project_id="p0-zero-fact",
        line_type=LineType.material,
        name="Zero fact material",
        unit="pcs",
        quantity_planned=5,
        quantity_actual=0,
        unit_price=100,
    )

    stats = material_stats([line])

    assert stats["planned"] == 500
    assert stats["actual"] == 0
    assert stats["overrun_percent"] == -100
