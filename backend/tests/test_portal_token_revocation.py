"""A portal magic link must be re-proved against current state.

`verify_portal_token` proves two things: this deployment signed the token, and
it has not expired. Everything the authenticated API checks per request was
missing on the portal path — a grep over the three portal routers for
`deleted_at`, `tokens_invalid_before` and `trashed_at` returned 0, 0 and 0
across 17 entry points, while `deps.get_current_user` /
`deps._validate_access_session` / `deps.require_project` check all three.

A portal token carries write scopes (accept_stage, pay, sign_document) and a
7-day default TTL, and it travels by SMS or email. So a leaked or mis-sent link
kept working for the rest of that week after the account was deleted, after
"sign out everywhere", after the participant was removed from the project, and
after the project was moved to the trash.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.core.timeutil import utc_now
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.entities import Project, User, UserRole
from app.services import portal_token_service as portal_tokens
from app.services.portal_access import authorize_portal

import app.models  # noqa: F401 — register every mapped table

WRITE_SCOPES = ["read", "accept_stage", "pay", "sign_document"]


@pytest.fixture
async def portal_project():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        await db.merge(
            User(
                id="portal-customer",
                phone="+79991110001",
                full_name="Customer",
                role=UserRole.customer,
                deleted_at=None,
                tokens_invalid_before=None,
            )
        )
        await db.merge(
            Project(
                id="portal-project",
                name="Portal",
                address="A",
                renovation_type="cosmetic",
                customer_id="portal-customer",
                trashed_at=None,
            )
        )
        await db.commit()
    yield


def _token() -> str:
    return portal_tokens.create_portal_token(
        project_id="portal-project",
        user_id="portal-customer",
        scopes=WRITE_SCOPES,
    )


async def _authorize(**kwargs):
    async with SessionLocal() as db:
        return await authorize_portal(
            db, token=_token(), project_id="portal-project", **kwargs
        )


async def _set_user(**fields):
    async with SessionLocal() as db:
        user = await db.get(User, "portal-customer")
        for key, value in fields.items():
            setattr(user, key, value)
        await db.commit()


async def _set_project(**fields):
    async with SessionLocal() as db:
        project = await db.get(Project, "portal-project")
        for key, value in fields.items():
            setattr(project, key, value)
        await db.commit()


# --- the happy path still works ---------------------------------------------


async def test_a_valid_link_still_authorizes(portal_project):
    access = await _authorize()

    assert access.user.id == "portal-customer"
    assert access.project.id == "portal-project"
    assert access.has_scope("accept_stage") is True


async def test_scope_is_enforced(portal_project):
    with pytest.raises(HTTPException) as raised:
        async with SessionLocal() as db:
            await authorize_portal(
                db,
                token=portal_tokens.create_portal_token(
                    project_id="portal-project",
                    user_id="portal-customer",
                    scopes=["read"],
                ),
                project_id="portal-project",
                required_scope="pay",
            )

    assert raised.value.status_code == 403
    assert "pay" in str(raised.value.detail)


# --- the four states a signature cannot see ----------------------------------


async def test_deleted_account_cannot_use_an_outstanding_link(portal_project):
    await _set_user(deleted_at=utc_now())
    try:
        with pytest.raises(HTTPException) as raised:
            await _authorize()
        assert raised.value.status_code == 401
        assert raised.value.detail == "account_deleted"
    finally:
        await _set_user(deleted_at=None)


async def test_sign_out_everywhere_revokes_an_outstanding_link(portal_project):
    """tokens_invalid_before is how a revoke-all actually takes effect."""
    await _set_user(tokens_invalid_before=utc_now() + timedelta(seconds=5))
    try:
        with pytest.raises(HTTPException) as raised:
            await _authorize()
        assert raised.value.status_code == 401
        assert raised.value.detail == "portal_token_revoked"
    finally:
        await _set_user(tokens_invalid_before=None)


async def test_a_link_minted_after_the_revocation_still_works(portal_project):
    """The cutoff must invalidate older links only, not the account forever."""
    await _set_user(tokens_invalid_before=utc_now() - timedelta(hours=1))
    try:
        access = await _authorize()
        assert access.user.id == "portal-customer"
    finally:
        await _set_user(tokens_invalid_before=None)


async def test_trashed_project_cannot_be_reached_through_a_link(portal_project):
    await _set_project(trashed_at=utc_now())
    try:
        with pytest.raises(HTTPException) as raised:
            await _authorize()
        assert raised.value.status_code == 404
    finally:
        await _set_project(trashed_at=None)


async def test_participant_removed_from_the_project_loses_the_link(portal_project):
    """The customer is reassigned; the old link must stop working."""
    await _set_project(customer_id="someone-else")
    try:
        with pytest.raises(HTTPException) as raised:
            await _authorize()
        assert raised.value.status_code == 403
        assert raised.value.detail == "portal_access_revoked"
    finally:
        await _set_project(customer_id="portal-customer")


# --- the checks that already existed must not regress ------------------------


async def test_token_for_another_project_is_rejected(portal_project):
    async with SessionLocal() as db:
        with pytest.raises(HTTPException) as raised:
            await authorize_portal(
                db, token=_token(), project_id="a-different-project"
            )

    assert raised.value.status_code == 401
    assert raised.value.detail == "token_mismatch"


async def test_tampered_token_is_rejected(portal_project):
    async with SessionLocal() as db:
        with pytest.raises(HTTPException) as raised:
            await authorize_portal(
                db, token=_token()[:-4] + "0000", project_id="portal-project"
            )

    assert raised.value.status_code == 401
    assert raised.value.detail == "invalid_portal_token"


async def test_unknown_user_is_rejected(portal_project):
    async with SessionLocal() as db:
        with pytest.raises(HTTPException) as raised:
            await authorize_portal(
                db,
                token=portal_tokens.create_portal_token(
                    project_id="portal-project",
                    user_id="ghost-user",
                    scopes=WRITE_SCOPES,
                ),
                project_id="portal-project",
            )

    assert raised.value.status_code == 401


# --- the token now carries what the check needs ------------------------------


def test_verify_exposes_the_mint_time():
    claims = portal_tokens.verify_portal_token(_token())

    assert isinstance(claims["issued_at"], int)
    assert claims["issued_at"] > 0


def test_existing_claim_shape_is_unchanged():
    """issued_at is additive; nothing that existed may change meaning."""
    claims = portal_tokens.verify_portal_token(_token())

    assert claims["user_id"] == "portal-customer"
    assert claims["project_id"] == "portal-project"
    assert claims["scopes"] == WRITE_SCOPES
    assert claims["read_only"] is False
