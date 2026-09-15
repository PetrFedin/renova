from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.v1 import estimate as api
from app.models.entities import EstimateLine, LineType, Project, User, UserRole


@pytest.mark.asyncio
async def test_estimate_patch_binds_line_to_authorized_path_project(db):
    contractor_id = "estimate-binding-contractor"
    project_a_id = "estimate-binding-project-a"
    project_b_id = "estimate-binding-project-b"
    line_a_id = "estimate-binding-line-a"
    line_b_id = "estimate-binding-line-b"

    contractor = User(
        id=contractor_id,
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
        id=project_a_id,
        name="Estimate A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor_id,
        budget_planned=200,
    )
    project_b = Project(
        id=project_b_id,
        name="Estimate B",
        renovation_type="cosmetic",
        customer_id=customer_b.id,
        contractor_id=contractor_id,
        budget_planned=600,
    )
    line_a = EstimateLine(
        id=line_a_id,
        project_id=project_a_id,
        line_type=LineType.material,
        name="Line A",
        unit="pcs",
        quantity_planned=2,
        quantity_actual=0,
        unit_price=100,
    )
    line_b = EstimateLine(
        id=line_b_id,
        project_id=project_b_id,
        line_type=LineType.material,
        name="Line B",
        unit="pcs",
        quantity_planned=3,
        quantity_actual=0,
        unit_price=200,
    )
    db.add_all([contractor, customer_a, customer_b, project_a, project_b, line_a, line_b])
    await db.commit()
    await db.refresh(contractor)

    with pytest.raises(HTTPException) as denied:
        await api.patch_line(
            project_a_id,
            line_b_id,
            api.LinePatch(unit_price=999),
            user=contractor,
            db=db,
        )
    assert denied.value.status_code == 404

    await db.refresh(line_b)
    await db.refresh(project_a)
    await db.refresh(project_b)
    assert line_b.unit_price == 200
    assert project_a.budget_planned == 200
    assert project_b.budget_planned == 600

    # The denied route may have rolled the session back and expired ORM state;
    # refresh the principal explicitly while keeping path/object ids immutable.
    await db.refresh(contractor)
    own = await api.patch_line(
        project_a_id,
        line_a_id,
        api.LinePatch(unit_price=150),
        user=contractor,
        db=db,
    )
    assert own["ok"] is True
    assert own["id"] == line_a_id
    assert own["unit_price"] == 150
    assert own["lifecycle_status"] == "active"
    assert own["origin"] == "manual"

    await db.refresh(line_a)
    await db.refresh(project_a)
    await db.refresh(project_b)
    assert line_a.unit_price == 150
    assert project_a.budget_planned == 300
    assert project_b.budget_planned == 600
