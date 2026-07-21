"""W60: portal schedule requires accept_stage; closeout needs acceptance act."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import portal_token_service as portal_tok


@pytest.mark.asyncio
async def test_portal_schedule_confirm_rejects_read_only_token(monkeypatch, db):
    monkeypatch.setattr("app.core.config.settings.secret_key", "test-secret-key-w60-sched!!!!!")
    from app.models.entities import Project, User, UserRole

    cust = User(id="c-w60", phone="+79990006001", role=UserRole.customer)
    project = Project(
        id="p-w60",
        name="W60",
        renovation_type="cosmetic",
        customer_id=cust.id,
        budget_planned=1,
        budget_spent=0,
    )
    db.add_all([cust, project])
    await db.commit()

    # read-only token must not confirm schedule
    token = portal_tok.create_portal_token(project_id=project.id, user_id=cust.id, scopes=["read"])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            f"/api/v1/portal/projects/{project.id}/work-schedules/any/confirm",
            json={"token": token},
        )
        assert r.status_code == 403, r.text
        assert "accept_stage" in r.text or "scope" in r.text.lower()


@pytest.mark.asyncio
async def test_closeout_not_ready_without_acceptance_act(db):
    from app.api.v1.export import _closeout_snapshot
    from app.models.entities import Project, Stage, StageStatus, User, UserRole

    cust = User(id="c-w60b", phone="+79990006002", role=UserRole.customer)
    project = Project(
        id="p-w60b",
        name="Closeout",
        renovation_type="cosmetic",
        customer_id=cust.id,
        budget_planned=1,
        budget_spent=0,
    )
    stage = Stage(
        id="s-w60b",
        project_id=project.id,
        name="Этап 1",
        status=StageStatus.done,
        sort_order=1,
    )
    db.add_all([cust, project, stage])
    await db.commit()

    snap = await _closeout_snapshot(db, project.id, project)
    assert snap["all_stages_done"] is True
    assert snap["acceptance_acts_active"] == 0
    assert snap["ready"] is False
    assert "акт" in snap["next_action"].lower() or "документ" in snap["next_action"].lower()
