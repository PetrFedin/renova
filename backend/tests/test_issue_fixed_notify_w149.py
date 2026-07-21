"""W149: contractor close → fixed + IssueFixed + notify customer; customer close → closed + notify contractor."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import ActivityEvent, AppNotification, Project, ProjectIssue, User, UserRole


@pytest.mark.asyncio
async def test_contractor_marks_fixed_notifies_customer(db):
    cust = User(id="c-w149", phone="+79990014901", role=UserRole.customer)
    contr = User(id="k-w149", phone="+79990014902", role=UserRole.contractor)
    project = Project(
        id="p-w149",
        name="W149",
        renovation_type="cosmetic",
        customer_id=cust.id,
        contractor_id=contr.id,
        budget_planned=1,
        budget_spent=0,
    )
    issue = ProjectIssue(
        id="i-w149",
        project_id=project.id,
        title="Царапина на двери",
        status="open",
        severity="medium",
    )
    db.add_all([cust, contr, project, issue])
    await db.commit()

    async def _db():
        yield db

    async def _user():
        return contr

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(f"/api/v1/projects/{project.id}/issues/{issue.id}/close")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "fixed"

        await db.refresh(issue)
        assert issue.status == "fixed"

        events = (
            await db.execute(select(ActivityEvent).where(ActivityEvent.project_id == project.id))
        ).scalars().all()
        kinds = {e.kind for e in events}
        assert "IssueFixed" in kinds
        assert "IssueClosed" not in kinds

        notifs = (
            await db.execute(select(AppNotification).where(AppNotification.user_id == cust.id))
        ).scalars().all()
        assert any("Исправлено" in (n.title or "") for n in notifs)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_customer_confirms_fixed_closes_and_notifies_contractor(db):
    cust = User(id="c-w149b", phone="+79990014911", role=UserRole.customer)
    contr = User(id="k-w149b", phone="+79990014912", role=UserRole.contractor)
    project = Project(
        id="p-w149b",
        name="W149b",
        renovation_type="cosmetic",
        customer_id=cust.id,
        contractor_id=contr.id,
        budget_planned=1,
        budget_spent=0,
    )
    issue = ProjectIssue(
        id="i-w149b",
        project_id=project.id,
        title="Царапина",
        status="fixed",
        severity="medium",
    )
    db.add_all([cust, contr, project, issue])
    await db.commit()

    async def _db():
        yield db

    async def _user():
        return cust

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(f"/api/v1/projects/{project.id}/issues/{issue.id}/close")
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "closed"

        events = (
            await db.execute(select(ActivityEvent).where(ActivityEvent.project_id == project.id))
        ).scalars().all()
        assert any(e.kind == "IssueClosed" for e in events)

        notifs = (
            await db.execute(select(AppNotification).where(AppNotification.user_id == contr.id))
        ).scalars().all()
        assert any("Закрыто" in (n.title or "") for n in notifs)
    finally:
        app.dependency_overrides.clear()
