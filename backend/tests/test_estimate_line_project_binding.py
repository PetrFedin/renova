from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1 import estimate as api
from app.models.entities import EstimateLine, LineType, Project, User, UserRole


@pytest.mark.asyncio
async def test_estimate_patch_binds_line_to_authorized_path_project(db):
    contractor = User(
        id="estimate-binding-contractor",
        phone="+78050000001",
        role=UserRole.contractor,
    )
    customer_a = User(
        id="estimate-binding-customer-a",
        phone="+78050000002",
        role=UserRole.customer,
    )
    customer_b = User(
        id="estimate-binding-customer-b",
        phone="+78050000003",
        role=UserRole.customer,
    )
    project_a = Project(
        id="estimate-binding-project-a",
        name="Estimate A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor.id,
        budget_planned=200,
    )
    project_b = Project(
        id="estimate-binding-project-b",
        name="Estimate B",
        renovation_type="cosmetic",
        customer_id=customer_b.id,
        contractor_id=contractor.id,
        budget_planned=600,
    )
    line_a = EstimateLine(
        id="estimate-binding-line-a",
        project_id=project_a.id,
        line_type=LineType.material,
        name="Line A",
        unit="pcs",
        quantity_planned=2,
        quantity_actual=0,
        unit_price=100,
    )
    line_b = EstimateLine(
        id="estimate-binding-line-b",
        project_id=project_b.id,
        line_type=LineType.material,
        name="Line B",
        unit="pcs",
        quantity_planned=3,
        quantity_actual=0,
        unit_price=200,
    )
    project_a_id = project_a.id
    project_b_id = project_b.id
    line_a_id = line_a.id
    line_b_id = line_b.id
    db.add_all([contractor, customer_a, customer_b, project_a, project_b, line_a, line_b])
    await db.commit()

    with pytest.raises(HTTPException) as denied:
        await api.patch_line(
            project_a_id,
            line_b_id,
            api.LinePatch(unit_price=999),
            user=contractor,
            db=db,
        )
    assert denied.value.status_code == 404

    line_b_price = (
        await db.execute(select(EstimateLine.unit_price).where(EstimateLine.id == line_b_id))
    ).scalar_one()
    project_a_budget = (
        await db.execute(select(Project.budget_planned).where(Project.id == project_a_id))
    ).scalar_one()
    project_b_budget = (
        await db.execute(select(Project.budget_planned).where(Project.id == project_b_id))
    ).scalar_one()
    assert line_b_price == 200
    assert project_a_budget == 200
    assert project_b_budget == 600

    own = await api.patch_line(
        project_a_id,
        line_a_id,
        api.LinePatch(unit_price=150),
        user=contractor,
        db=db,
    )
    assert own == {"ok": True, "id": line_a_id}

    line_a_price = (
        await db.execute(select(EstimateLine.unit_price).where(EstimateLine.id == line_a_id))
    ).scalar_one()
    project_a_budget = (
        await db.execute(select(Project.budget_planned).where(Project.id == project_a_id))
    ).scalar_one()
    project_b_budget = (
        await db.execute(select(Project.budget_planned).where(Project.id == project_b_id))
    ).scalar_one()
    assert line_a_price == 150
    assert project_a_budget == 300
    assert project_b_budget == 600
