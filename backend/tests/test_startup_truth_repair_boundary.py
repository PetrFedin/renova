"""API startup must not rewrite business rows in a deployed environment.

`init_db` ran three legacy truth repairs inside FastAPI's lifespan. Those
repairs mutate receipt verification state and the expenses derived from it,
Moy Nalog provider connections, and OCR suggestions. Running them from lifespan
means they execute on every API start — every deploy, restart, replica and
rollback — with N replicas racing concurrent passes over the same tables, and
with no bound on the duration of the pass.

They are idempotent, which made that survivable, not correct. A data migration
is an operator action with a decision, a log and a result.

Local and test keep the historical self-healing behaviour so a developer
database still repairs itself; staging and production run the same code once,
explicitly, through `python -m app.ops.truth_repair`.
"""
from __future__ import annotations

import inspect

import pytest

from app.core.config import Settings
from app.db import session as db_session


def _settings(**overrides) -> Settings:
    values = {
        "environment": "staging",
        "database_url": "postgresql+asyncpg://renova:db-secret@db.internal/renova",
        "public_base_url": "https://api-staging.renova.example",
        "secret_key": "unique-staging-secret-key-32-characters",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_deployed_startup_does_not_repair_by_default(monkeypatch, environment: str):
    monkeypatch.setattr(db_session, "settings", _settings(environment=environment))

    assert db_session.startup_truth_repair_enabled() is False


@pytest.mark.parametrize("environment", ["development", "test"])
def test_local_startup_keeps_self_healing(monkeypatch, environment: str):
    monkeypatch.setattr(
        db_session,
        "settings",
        _settings(environment=environment, database_url="sqlite+aiosqlite:///./x.db"),
    )

    assert db_session.startup_truth_repair_enabled() is True


def test_operator_may_opt_a_deployed_runtime_back_in(monkeypatch):
    monkeypatch.setattr(
        db_session,
        "settings",
        _settings(environment="production", run_startup_truth_repair=True),
    )

    assert db_session.startup_truth_repair_enabled() is True


def test_operator_may_opt_a_local_runtime_out(monkeypatch):
    monkeypatch.setattr(
        db_session,
        "settings",
        _settings(
            environment="development",
            database_url="sqlite+aiosqlite:///./x.db",
            run_startup_truth_repair=False,
        ),
    )

    assert db_session.startup_truth_repair_enabled() is False


def test_init_db_checks_the_gate_before_touching_business_rows():
    source = inspect.getsource(db_session.init_db)

    gate = source.index("startup_truth_repair_enabled()")
    first_repair = source.index("repair_legacy_receipt_truth(db)")
    assert gate < first_repair


def test_init_db_still_validates_schema_before_anything_else():
    source = inspect.getsource(db_session.init_db)

    assert source.index("await _prepare_database_schema()") < source.index(
        "startup_truth_repair_enabled()"
    )


def test_ops_entry_point_exists_and_supports_a_dry_run():
    from app.ops import truth_repair

    assert inspect.iscoroutinefunction(truth_repair.run)
    signature = inspect.signature(truth_repair.run)
    assert "dry_run" in signature.parameters

    source = inspect.getsource(truth_repair.run)
    # A dry run must leave the database untouched.
    assert "await db.rollback()" in source
    assert source.index("if dry_run:") < source.index("await db.commit()")
