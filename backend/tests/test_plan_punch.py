"""P2.3: plan-pinned punch list."""
import pytest

from app.models.entities import FloorPlan, Project, ProjectIssue, User, UserRole
from app.services import issue_service as iss


@pytest.mark.asyncio
async def test_create_plan_pinned_issue(db):
    user = User(id="u-punch", phone="+79991112233", role=UserRole.contractor)
    db.add(user)
    project = Project(
        id="proj-punch",
        name="Punch plan",
        renovation_type="cosmetic",
        customer_id=user.id,
        contractor_id=user.id,
        budget_planned=100000,
        budget_spent=0,
    )
    plan = FloorPlan(id="plan-1", project_id=project.id, name="Этаж 1", image_key="plans/test.jpg")
    db.add_all([project, plan])
    await db.commit()

    issue = await iss.create_issue(
        db,
        project.id,
        "Скол плитки",
        description="У входа",
        severity="high",
        floor_plan_id=plan.id,
        x_pct=42.5,
        y_pct=67.0,
        photo_key="issues/photo1.jpg",
    )

    assert issue.floor_plan_id == plan.id
    assert issue.x_pct == 42.5
    assert issue.y_pct == 67.0
    assert issue.photo_key == "issues/photo1.jpg"

    d = iss.issue_dict(issue)
    assert d["photo_url"] == "/api/v1/media/issues/photo1.jpg"
    assert d["floor_plan_id"] == plan.id


@pytest.mark.asyncio
async def test_list_issues_with_plan_filter(db):
    user = User(id="u-punch2", phone="+79992223344", role=UserRole.customer)
    db.add(user)
    project = Project(
        id="proj-punch2",
        name="Punch filter",
        renovation_type="cosmetic",
        customer_id=user.id,
        budget_planned=50000,
        budget_spent=0,
    )
    plan_a = FloorPlan(id="plan-a", project_id=project.id, name="A", image_key="a.jpg")
    plan_b = FloorPlan(id="plan-b", project_id=project.id, name="B", image_key="b.jpg")
    db.add_all([project, plan_a, plan_b])
    await db.commit()

    db.add_all([
        ProjectIssue(project_id=project.id, title="On A", floor_plan_id=plan_a.id, x_pct=10, y_pct=20, severity="medium", status="open"),
        ProjectIssue(project_id=project.id, title="On B", floor_plan_id=plan_b.id, x_pct=30, y_pct=40, severity="low", status="open"),
        ProjectIssue(project_id=project.id, title="No pin", severity="low", status="open"),
    ])
    await db.commit()

    items = await iss.list_issues(db, project.id)
    pinned = [i for i in items if i.floor_plan_id == plan_a.id]
    assert len(pinned) == 1
    assert pinned[0].title == "On A"
