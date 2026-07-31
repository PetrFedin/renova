from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.main import app
from app.models.entities import User, UserRole, UserSession
from app.services import session_service
from app.services.account_lifecycle_service import soft_delete_account
from app.services.account_purge_guard import (
    AccountPurgeForbidden,
    AccountPurgeUnavailable,
    validate_account_purge_access,
)


@pytest_asyncio.fixture
async def account_store(tmp_path):
    db_path = tmp_path / "account-lifecycle.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


async def _create_user(session_factory, *, user_id: str, phone: str) -> None:
    async with session_factory() as db:
        db.add(User(id=user_id, phone=phone, role=UserRole.customer, full_name="Active User"))
        await db.commit()


@pytest.mark.asyncio
async def test_soft_delete_commits_without_refresh_sessions(account_store):
    await _create_user(account_store, user_id="delete-no-session", phone="+79990002001")

    async with account_store() as db:
        user = await db.get(User, "delete-no-session")
        result = await soft_delete_account(db, user)

    assert result["soft_deleted"] is True
    assert result["revoked_sessions"] == 0

    async with account_store() as db:
        stored = await db.get(User, "delete-no-session")
    assert stored.deleted_at is not None
    assert stored.deletion_requested_at is not None
    assert stored.tokens_invalid_before is not None
    assert stored.phone.startswith("deleted-")
    assert stored.full_name == "Deleted"


@pytest.mark.asyncio
async def test_soft_delete_revokes_sessions_in_same_transition(account_store):
    await _create_user(account_store, user_id="delete-with-session", phone="+79990002002")
    async with account_store() as db:
        session, _raw = await session_service.create_session(db, "delete-with-session")

    async with account_store() as db:
        user = await db.get(User, "delete-with-session")
        result = await soft_delete_account(db, user)

    assert result["revoked_sessions"] == 1
    async with account_store() as db:
        stored_user = await db.get(User, "delete-with-session")
        stored_session = await db.get(UserSession, session.id)
    assert stored_user.deleted_at is not None
    assert stored_session.revoked_at is not None


@pytest.mark.asyncio
async def test_revoke_all_commit_false_preserves_caller_transaction(account_store):
    await _create_user(account_store, user_id="transaction-user", phone="+79990002003")

    async with account_store() as db:
        user = await db.get(User, "transaction-user")
        user.full_name = "Committed With Zero Sessions"
        revoked = await session_service.revoke_all_user_sessions(
            db,
            user.id,
            commit=False,
        )
        assert revoked == 0
        await db.commit()

    async with account_store() as db:
        stored = await db.get(User, "transaction-user")
    assert stored.full_name == "Committed With Zero Sessions"


def test_account_purge_guard_is_fail_closed():
    secret = "s" * 32

    with pytest.raises(AccountPurgeForbidden, match="not_available"):
        validate_account_purge_access(
            environment="development",
            enabled=True,
            configured_secret=secret,
            provided_secret=secret,
        )
    with pytest.raises(AccountPurgeForbidden, match="disabled"):
        validate_account_purge_access(
            environment="production",
            enabled=False,
            configured_secret=secret,
            provided_secret=secret,
        )
    with pytest.raises(AccountPurgeUnavailable, match="not_configured"):
        validate_account_purge_access(
            environment="staging",
            enabled=True,
            configured_secret="short",
            provided_secret=secret,
        )
    with pytest.raises(AccountPurgeForbidden, match="invalid"):
        validate_account_purge_access(
            environment="production",
            enabled=True,
            configured_secret=secret,
            provided_secret="x" * 32,
        )

    validate_account_purge_access(
        environment="production",
        enabled=True,
        configured_secret=secret,
        provided_secret=secret,
    )


def test_account_lifecycle_runtime_routes_are_unique():
    expected = {
        ("/api/v1/auth/anonymize", "POST"),
        ("/api/v1/auth/me", "DELETE"),
        ("/api/v1/auth/sessions/revoke-all", "POST"),
        ("/api/v1/auth/admin/purge-deleted-accounts", "POST"),
        ("/api/v1/auth/me", "GET"),
    }
    for path, method in expected:
        matches = [
            route
            for route in app.routes
            if isinstance(route, APIRoute)
            and route.path == path
            and method in route.methods
        ]
        assert len(matches) == 1, (path, method, matches)


def test_account_lifecycle_source_guards_against_rollback_regression():
    backend = Path(__file__).resolve().parents[1]
    session_source = (backend / "app" / "services" / "session_service.py").read_text(
        encoding="utf-8"
    )
    start = session_source.index("async def revoke_all_user_sessions")
    block = session_source[start:]
    assert "commit: bool = True" in block
    assert "if commit:" in block
    assert "await db.rollback()" not in block

    lifecycle_source = (
        backend / "app" / "services" / "account_lifecycle_service.py"
    ).read_text(encoding="utf-8")
    assert "commit=False" in lifecycle_source
    assert "await db.commit()" in lifecycle_source
    assert "await db.rollback()" in lifecycle_source
