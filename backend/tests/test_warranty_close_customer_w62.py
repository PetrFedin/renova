"""W62: warranty claim close is customer-only."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, ProjectIssue, User, UserRole


@pytest.mark.asyncio
async def test_warranty_close_rejects_contractor(db):
    cust = User(id="c-w62", phone="+79990006201", role=UserRole.customer)
    contr = User(id="k-w62", phone="+79990006202", role=UserRole.contractor)
    project = Project(
        id="p-w62",
        name="W62",
        renovation_type="cosmetic",
        customer_id=cust.id,
        budget_planned=1,
        budget_spent=0,
    )
    issue = ProjectIssue(
        id="i-w62",
        project_id=project.id,
        title="[Гарантия] Течь",
        description="кухня",
        status="open",
        severity="high",
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
            r = await client.post(
                f"/api/v1/projects/{project.id}/warranty-claims/{issue.id}/close",
            )
            assert r.status_code == 403, r.text
            assert "warranty_close_customer_only" in r.text

            r2 = await client.post(
                f"/api/v1/projects/{project.id}/issues/{issue.id}/close",
            )
            assert r2.status_code == 403, r2.text
    finally:
        app.dependency_overrides.clear()
