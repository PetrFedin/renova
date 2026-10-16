"""Portal write routes must reject revoked, legacy and spent magic links."""
import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import PortalLink
from app.services.portal_link_service import require_registered_write_scope

pytestmark = pytest.mark.asyncio


async def test_portal_write_guard_rejects_legacy(db: AsyncSession):
    with pytest.raises(HTTPException) as err:
        await require_registered_write_scope(
            db, claims={"project_id": "p", "user_id": "u", "scopes": ["accept_stage"], "jti": None},
            project_id="p", scope="accept_stage",
        )
    assert err.value.status_code == 410


async def test_portal_write_guard_rejects_scope_not_signed(db: AsyncSession):
    with pytest.raises(HTTPException) as err:
        await require_registered_write_scope(
            db, claims={"project_id": "p", "user_id": "u", "scopes": ["read"], "jti": "id"},
            project_id="p", scope="sign_document",
        )
    assert err.value.status_code == 403


async def test_portal_write_guard_hides_foreign_project(db: AsyncSession):
    with pytest.raises(HTTPException) as err:
        await require_registered_write_scope(
            db, claims={"project_id": "other", "user_id": "u", "scopes": ["accept_stage"], "jti": "id"},
            project_id="p", scope="accept_stage",
        )
    assert err.value.status_code == 404


async def test_portal_write_guard_rejects_missing_registry(db: AsyncSession):
    with pytest.raises(HTTPException) as err:
        await require_registered_write_scope(
            db, claims={"project_id": "p", "user_id": "u", "scopes": ["sign_document"], "jti": "missing"},
            project_id="p", scope="sign_document",
        )
    assert err.value.status_code == 410


async def test_registered_scope_rejects_revoked_link_and_preserves_consumed_right(db: AsyncSession):
    from datetime import timedelta
    from app.core.timeutil import utc_now
    from app.models.entities import Project, User, UserRole
    from app.services import portal_link_service as links

    customer = User(id="portal-guard-customer", phone="+79990180551", role=UserRole.customer)
    project = Project(
        id="portal-guard-project", name="Guard", renovation_type="cosmetic",
        customer_id=customer.id, budget_planned=1, budget_spent=0,
    )
    db.add(customer)
    await db.flush()
    db.add(project)
    await db.commit()
    link, token = await links.issue_link(
        db, project_id=project.id, user_id=customer.id, issued_by=customer.id,
        scopes=["read", "accept_stage", "sign_document"], ttl_hours=1,
    )
    claims = {"project_id": project.id, "user_id": customer.id,
              "scopes": ["read", "accept_stage", "sign_document"], "jti": link.id}
    assert (await require_registered_write_scope(
        db, claims=claims, project_id=project.id, scope="sign_document"
    )).id == link.id
    link.accept_stage_consumed_at = utc_now()
    await db.commit()
    with pytest.raises(HTTPException) as spent:
        await require_registered_write_scope(
            db, claims=claims, project_id=project.id, scope="accept_stage"
        )
    assert spent.value.status_code == 410
    assert (await require_registered_write_scope(
        db, claims=claims, project_id=project.id, scope="sign_document"
    )).id == link.id
    await links.revoke_link(db, link)
    with pytest.raises(HTTPException) as revoked:
        await require_registered_write_scope(
            db, claims=claims, project_id=project.id, scope="sign_document"
        )
    assert revoked.value.status_code == 410
