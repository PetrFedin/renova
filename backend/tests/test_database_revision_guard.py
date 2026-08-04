from __future__ import annotations

import inspect

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.db import migration_guard
from app.db import session as db_session


@pytest_asyncio.fixture
async def revision_engine() -> AsyncEngine:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    yield engine
    await engine.dispose()


async def _write_heads(engine: AsyncEngine, *heads: str) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "CREATE TABLE alembic_version ("
                "version_num VARCHAR(64) NOT NULL PRIMARY KEY"
                ")"
            )
        )
        for head in heads:
            await connection.execute(
                text("INSERT INTO alembic_version(version_num) VALUES (:head)"),
                {"head": head},
            )


def test_bundled_heads_are_resolved_independently_of_process_cwd(
    monkeypatch,
    tmp_path,
):
    monkeypatch.chdir(tmp_path)

    assert migration_guard.bundled_alembic_heads() == (
        "w8calendarintegrity01",
    )


@pytest.mark.asyncio
async def test_empty_database_is_rejected_with_actionable_upgrade_command(
    revision_engine,
    monkeypatch,
):
    monkeypatch.setattr(
        migration_guard,
        "bundled_alembic_heads",
        lambda: ("expected-head",),
    )

    with pytest.raises(migration_guard.DatabaseRevisionError) as exc_info:
        await migration_guard.assert_database_at_head(revision_engine)

    message = str(exc_info.value)
    assert "expected=expected-head" in message
    assert "current=<none>" in message
    assert "missing=expected-head" in message
    assert "python -m alembic upgrade head" in message


@pytest.mark.asyncio
async def test_matching_database_head_is_accepted(revision_engine, monkeypatch):
    await _write_heads(revision_engine, "expected-head")
    monkeypatch.setattr(
        migration_guard,
        "bundled_alembic_heads",
        lambda: ("expected-head",),
    )

    state = await migration_guard.assert_database_at_head(revision_engine)

    assert state.is_current is True
    assert state.current_heads == ("expected-head",)
    assert state.expected_heads == ("expected-head",)


@pytest.mark.asyncio
async def test_behind_database_is_rejected(revision_engine, monkeypatch):
    await _write_heads(revision_engine, "old-head")
    monkeypatch.setattr(
        migration_guard,
        "bundled_alembic_heads",
        lambda: ("expected-head",),
    )

    with pytest.raises(migration_guard.DatabaseRevisionError) as exc_info:
        await migration_guard.assert_database_at_head(revision_engine)

    message = str(exc_info.value)
    assert "current=old-head" in message
    assert "missing=expected-head" in message
    assert "unexpected=old-head" in message


@pytest.mark.asyncio
async def test_database_ahead_of_running_code_is_rejected(
    revision_engine,
    monkeypatch,
):
    await _write_heads(revision_engine, "future-head")
    monkeypatch.setattr(
        migration_guard,
        "bundled_alembic_heads",
        lambda: ("expected-head",),
    )

    with pytest.raises(migration_guard.DatabaseRevisionError) as exc_info:
        await migration_guard.assert_database_at_head(revision_engine)

    message = str(exc_info.value)
    assert "expected=expected-head" in message
    assert "current=future-head" in message
    assert "unexpected=future-head" in message


@pytest.mark.asyncio
async def test_divergent_multi_head_database_requires_exact_set(
    revision_engine,
    monkeypatch,
):
    await _write_heads(revision_engine, "branch-a", "unexpected-branch")
    monkeypatch.setattr(
        migration_guard,
        "bundled_alembic_heads",
        lambda: ("branch-a", "branch-b"),
    )

    with pytest.raises(migration_guard.DatabaseRevisionError) as exc_info:
        await migration_guard.assert_database_at_head(revision_engine)

    message = str(exc_info.value)
    assert "expected=branch-a, branch-b" in message
    assert "current=branch-a, unexpected-branch" in message
    assert "missing=branch-b" in message
    assert "unexpected=unexpected-branch" in message


@pytest.mark.asyncio
async def test_matching_multi_head_database_is_accepted(
    revision_engine,
    monkeypatch,
):
    await _write_heads(revision_engine, "branch-b", "branch-a")
    monkeypatch.setattr(
        migration_guard,
        "bundled_alembic_heads",
        lambda: ("branch-a", "branch-b"),
    )

    state = await migration_guard.assert_database_at_head(revision_engine)

    assert state.is_current is True
    assert state.current_heads == ("branch-a", "branch-b")


@pytest.mark.asyncio
@pytest.mark.parametrize("environment", ["staging", "production", "stage", "prod"])
async def test_working_schema_preparation_requires_revision_guard(
    environment,
    monkeypatch,
):
    calls: list[object] = []

    async def verified(engine):
        calls.append(engine)
        return migration_guard.DatabaseRevisionState(
            expected_heads=("head",),
            current_heads=("head",),
        )

    monkeypatch.setattr(db_session.settings, "environment", environment)
    monkeypatch.setattr(db_session, "assert_database_at_head", verified)

    await db_session._prepare_database_schema()

    assert calls == [db_session.engine]


@pytest.mark.asyncio
async def test_local_schema_preparation_does_not_require_revision_guard(monkeypatch):
    called = False

    async def must_not_run(_engine):
        nonlocal called
        called = True
        raise AssertionError("working revision guard called in local environment")

    monkeypatch.setattr(db_session.settings, "environment", "development")
    monkeypatch.setattr(
        db_session.settings,
        "database_url",
        "postgresql+asyncpg://local.invalid/renova",
    )
    monkeypatch.setattr(db_session.settings, "allow_create_all", False)
    monkeypatch.setattr(db_session, "assert_database_at_head", must_not_run)

    await db_session._prepare_database_schema()

    assert called is False


@pytest.mark.asyncio
async def test_init_db_stops_before_truth_repairs_when_schema_guard_fails(
    monkeypatch,
):
    async def fail_before_repair():
        raise migration_guard.DatabaseRevisionError("stale-schema")

    monkeypatch.setattr(db_session, "_prepare_database_schema", fail_before_repair)

    with pytest.raises(migration_guard.DatabaseRevisionError, match="stale-schema"):
        await db_session.init_db()


def test_init_db_orders_schema_validation_before_truth_repairs():
    source = inspect.getsource(db_session.init_db)

    assert source.index("await _prepare_database_schema()") < source.index(
        "repair_legacy_ocr_truth"
    )
