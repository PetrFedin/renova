"""W63: issue close must not mutate another project's issue."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, ProjectIssue, User, UserRole


@pytest.mark.asyncio
async def test_close_rejects_cross_project_before_mutate(db):
    cust = User(id="c-w63", phone="+79990006301", role=UserRole.customer)
    pa = Project(id="pa-w63", name="A", renovation_type="cosmetic", customer_id=cust.id, budget_planned=1, budget_spent=0)
    pb = Project(id="pb-w63", name="B", renovation_type="cosmetic", customer_id=cust.id, budget_planned=1, budget_spent=0)
    foreign = ProjectIssue(
        id="i-w63-b",
        project_id=pb.id,
        title="[Гарантия] Чужое",
        status="open",
        severity="high",
    )
    db.add_all([cust, pa, pb, foreign])
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
            r = await client.post(f"/api/v1/projects/{pa.id}/issues/{foreign.id}/close")
            assert r.status_code == 404, r.text
        await db.refresh(foreign)
        assert foreign.status == "open"
    finally:
        app.dependency_overrides.clear()
