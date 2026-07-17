"""P2.1: portal magic link JWT."""
import pytest

from app.models.entities import Project, ProjectViewer, User, UserRole
from app.services import portal_token_service as portal_tok


@pytest.mark.asyncio
async def test_portal_token_roundtrip(db, monkeypatch):
    from app.core import config as cfg

    monkeypatch.setattr(cfg.settings, "secret_key", "test-secret-key-32chars-min!!")
    monkeypatch.setattr(cfg.settings, "public_base_url", "http://127.0.0.1:8081")

    customer = User(id="cust-p", phone="+79991111111", role=UserRole.customer)
    guest = User(id="guest-p", phone="+79992222222", role=UserRole.customer)
    db.add_all([customer, guest])
    project = Project(
        id="proj-p",
        name="Portal",
        renovation_type="cosmetic",
        customer_id=customer.id,
        budget_planned=100000,
        budget_spent=0,
    )
    db.add(project)
    db.add(ProjectViewer(project_id=project.id, user_id=guest.id))
    await db.commit()

    token = portal_tok.create_portal_token(project_id=project.id, user_id=guest.id, ttl_hours=1)
    claims = portal_tok.verify_portal_token(token)
    assert claims["project_id"] == project.id
    assert claims["user_id"] == guest.id
    assert claims["read_only"] is True
    assert "token=" in portal_tok.portal_url(token)


@pytest.mark.asyncio
async def test_portal_token_scopes(db, monkeypatch):
    from app.models.entities import Project, User, UserRole
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-portal")
    from app.core import config
    config.settings.secret_key = "test-secret-key-for-portal"
    customer = User(id="cust-p", phone="+79990000001", role=UserRole.customer)
    project = Project(id="proj-p", name="P", renovation_type="cosmetic", customer_id=customer.id, budget_planned=1, budget_spent=0)
    db.add_all([customer, project])
    await db.commit()
    token = portal_tok.create_portal_token(project_id=project.id, user_id=customer.id, scopes=["read", "accept_stage"])
    claims = portal_tok.verify_portal_token(token)
    assert "accept_stage" in claims.get("scopes", [])
