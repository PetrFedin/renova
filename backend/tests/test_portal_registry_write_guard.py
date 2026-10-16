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
