"""Deployment contracts for ADMIN_USER_IDS format, database state, and privacy."""
from __future__ import annotations

import inspect
import json

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import admin
from app.core import runtime_preflight
from app.core.admin_identity import parse_admin_user_ids
from app.core.config import settings
from app.db.base import Base
from app.models.entities import User, UserRole
from app.services.admin_identity_service import (
    assert_admin_identities,
    inspect_admin_identities,
)
from app.services.staging_readiness import build_h0_readiness_with_database

pytestmark = pytest.mark.asyncio


async def _database(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'admin-identity.db'}"
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def test_parser_retains_operator_errors_without_imposing_uuid_format():
    state = parse_admin_user_ids(
        " admin-alpha, ,admin-alpha,legacy:opaque-user-id "
    )

    assert state.configured_ids == ("admin-alpha", "legacy:opaque-user-id")
    assert state.raw_entry_count == 4
    assert state.blank_entry_count == 1
    assert state.duplicate_count == 1
    assert state.is_strictly_valid is False
    diagnostics = state.public_diagnostics()
    serialized = json.dumps(diagnostics, sort_keys=True)
    assert diagnostics["configured_count"] == 2
    assert "admin-alpha" not in serialized
    assert "legacy:opaque-user-id" not in serialized


async def test_database_verification_reports_only_aggregate_counts(tmp_path):
    engine, sessions = await _database(tmp_path)
    configured_ids = (
        "admin-valid-secret-id",
        "admin-wrong-role-secret-id",
        "admin-missing-secret-id",
    )
    try:
        async with sessions() as db:
            db.add_all(
                [
                    User(
                        id=configured_ids[0],
                        phone="+79990009301",
                        role=UserRole.contractor,
                    ),
                    User(
                        id=configured_ids[1],
                        phone="+79990009302",
                        role=UserRole.customer,
                    ),
                ]
            )
            await db.commit()

            state = await inspect_admin_identities(db, configured_ids)
            assert state.ok is False
            assert state.configured_count == 3
            assert state.valid_contractor_count == 1
            assert state.missing_count == 1
            assert state.wrong_role_count == 1
            public = json.dumps(state.public_diagnostics(), sort_keys=True)
            for user_id in configured_ids:
                assert user_id not in public

            with pytest.raises(ValueError) as exc_info:
                await assert_admin_identities(db, configured_ids)
            error = str(exc_info.value)
            assert "configured_count=3" in error
            assert "valid_contractor_count=1" in error
            assert "missing_count=1" in error
            assert "wrong_role_count=1" in error
            for user_id in configured_ids:
                assert user_id not in error
    finally:
        await engine.dispose()


async def test_h0_readiness_blocks_mixed_database_identities_without_leaking_ids(
    tmp_path,
    monkeypatch,
):
    engine, sessions = await _database(tmp_path)
    configured_ids = (
        "h0-valid-secret-id",
        "h0-wrong-role-secret-id",
        "h0-missing-secret-id",
    )
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "admin_user_ids", ",".join(configured_ids))
    monkeypatch.setattr(settings, "auth_allow_header_user_id", False)
    monkeypatch.setattr(settings, "public_base_url", "https://staging.renova.example")
    try:
        async with sessions() as db:
            db.add_all(
                [
                    User(
                        id=configured_ids[0],
                        phone="+79990009401",
                        role=UserRole.contractor,
                    ),
                    User(
                        id=configured_ids[1],
                        phone="+79990009402",
                        role=UserRole.customer,
                    ),
                ]
            )
            await db.commit()

            payload = await build_h0_readiness_with_database(db)

        admin_check = next(
            check for check in payload["checks"] if check["id"] == "admin_identity"
        )
        assert admin_check["ok"] is False
        assert admin_check["strict_format_ok"] is True
        assert admin_check["database_checked"] is True
        assert admin_check["database_ok"] is False
        assert admin_check["configured_count"] == 3
        assert admin_check["valid_contractor_count"] == 1
        assert admin_check["missing_count"] == 1
        assert admin_check["wrong_role_count"] == 1
        assert payload["ready_for_investor_demo"] is False
        assert any(
            blocker["id"] == "admin_identity" for blocker in payload["blockers"]
        )
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        for user_id in configured_ids:
            assert user_id not in serialized
    finally:
        await engine.dispose()


async def test_h0_readiness_accepts_all_existing_contractors(tmp_path, monkeypatch):
    engine, sessions = await _database(tmp_path)
    configured_ids = ("h0-admin-one", "h0-admin-two")
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "admin_user_ids", ",".join(configured_ids))
    monkeypatch.setattr(settings, "auth_allow_header_user_id", False)
    monkeypatch.setattr(settings, "public_base_url", "https://staging.renova.example")
    try:
        async with sessions() as db:
            db.add_all(
                [
                    User(
                        id=user_id,
                        phone=f"+7999{index:07d}",
                        role=UserRole.contractor,
                    )
                    for index, user_id in enumerate(configured_ids, start=9501)
                ]
            )
            await db.commit()
            payload = await build_h0_readiness_with_database(db)

        admin_check = next(
            check for check in payload["checks"] if check["id"] == "admin_identity"
        )
        assert admin_check["ok"] is True
        assert admin_check["database_ok"] is True
        assert admin_check["valid_contractor_count"] == 2
        assert admin_check["missing_count"] == 0
        assert admin_check["wrong_role_count"] == 0
    finally:
        await engine.dispose()


def test_admin_endpoint_and_live_preflight_use_database_verification():
    endpoint_source = inspect.getsource(admin.h0_readiness)
    preflight_source = inspect.getsource(runtime_preflight.run_preflight)

    assert "build_h0_readiness_with_database" in endpoint_source
    assert "Depends(get_db)" in endpoint_source
    assert "await build_h0_readiness_with_database(db)" in endpoint_source
    assert '"admin_identity_database"' in preflight_source
    assert "assert_admin_identities" in preflight_source
    assert preflight_source.index('"database_revision"') < preflight_source.index(
        '"admin_identity_database"'
    )
