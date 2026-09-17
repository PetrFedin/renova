from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1 import os as os_api
from app.models.entities import FloorPlan, Project, ProjectIssue, Room, Stage, User, UserRole


@pytest.mark.asyncio
async def test_issue_create_binds_room_stage_and_floor_plan_to_path_project(db):
    customer = User(id="issue-ref-user", phone="+79990004740", role=UserRole.customer)
    db.add(customer)
    await db.flush()

    project_a = Project(
        id="issue-ref-project-a",
        name="Issue A",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    project_b = Project(
        id="issue-ref-project-b",
        name="Issue B",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add_all([project_a, project_b])
    await db.flush()

    room_a = Room(
        id="issue-ref-room-a",
        project_id=project_a.id,
        name="Room A",
        room_type="living",
        length_m=4,
        width_m=3,
    )
    room_b = Room(
        id="issue-ref-room-b",
        project_id=project_b.id,
        name="Room B",
        room_type="living",
        length_m=5,
        width_m=3,
    )
    stage_a = Stage(id="issue-ref-stage-a", project_id=project_a.id, name="Stage A")
    stage_b = Stage(id="issue-ref-stage-b", project_id=project_b.id, name="Stage B")
    plan_a = FloorPlan(
        id="issue-ref-plan-a",
        project_id=project_a.id,
        name="Plan A",
        image_key="tests/issue-plan-a.png",
    )
    plan_b = FloorPlan(
        id="issue-ref-plan-b",
        project_id=project_b.id,
        name="Plan B",
        image_key="tests/issue-plan-b.png",
    )
    db.add_all([room_a, room_b, stage_a, stage_b, plan_a, plan_b])
    await db.commit()

    foreign_cases = [
        os_api.IssueIn(title="Foreign room", room_id=room_b.id),
        os_api.IssueIn(title="Foreign stage", stage_id=stage_b.id),
        os_api.IssueIn(title="Foreign floor plan", floor_plan_id=plan_b.id, x_pct=20, y_pct=30),
    ]
    for body in foreign_cases:
        with pytest.raises(HTTPException) as rejected:
            await os_api.create_issue(project_a.id, body, user=customer, db=db)
        assert rejected.value.status_code == 404

    leaked = list(
        (
            await db.execute(
                select(ProjectIssue).where(
                    ProjectIssue.project_id == project_a.id,
                    ProjectIssue.title.in_(["Foreign room", "Foreign stage", "Foreign floor plan"]),
                )
            )
        ).scalars().all()
    )
    assert leaked == []

    own = await os_api.create_issue(
        project_a.id,
        os_api.IssueIn(
            title="Own references",
            room_id=room_a.id,
            stage_id=stage_a.id,
            floor_plan_id=plan_a.id,
            x_pct=40,
            y_pct=50,
        ),
        user=customer,
        db=db,
    )
    assert own["project_id"] == project_a.id
    assert own["room_id"] == room_a.id
    assert own["stage_id"] == stage_a.id
    assert own["floor_plan_id"] == plan_a.id
