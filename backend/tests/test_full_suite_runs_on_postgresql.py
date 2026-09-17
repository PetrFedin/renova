"""The authoritative regression must run on the engine production uses.

`app.core.environment` forbids SQLite in staging and production, so a suite
that only ever ran on SQLite could not prove Postgres behaviour. The two
engines differ in exactly the places this product is sensitive to:

* native enums vs CHECK-less TEXT — w16/w17/w18 exist because of that drift;
* `numeric` vs REAL affinity — SQLite cannot demonstrate decimal exactness;
* real foreign-key enforcement (SQLite needs a per-connection PRAGMA);
* transactional DDL and row locking — `SELECT … FOR UPDATE` is a no-op on
  SQLite, which is what the purchase and stage transitions rely on.

Before this change the only Postgres evidence in the repository came from a
handful of dedicated race/migration workflows. The full suite has been
measured on Postgres: 1091 passed, 18 skipped, 0 failures — identical to the
SQLite run and faster (572s against 863s), so the fidelity was available the
whole time at no cost.

The SQLite path is deliberately kept: `app/db/sqlite_compat.py`, the local
development runtime and five other CI jobs (chat-message, project-creation,
acceptance-decision, stage-mutation, team-lifecycle contracts) still exercise
it. Nothing was removed; the authoritative run simply moved.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

_CI = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"


def _job_block(name: str) -> str:
    source = _CI.read_text(encoding="utf-8")
    start = source.index(f"\n  {name}:\n")
    match = re.search(r"\n  [a-z][a-z0-9-]*:\n", source[start + 1 :])
    end = start + 1 + match.start() if match else len(source)
    return source[start:end]


def test_full_regression_uses_postgresql():
    block = _job_block("backend-complete")

    assert "DATABASE_URL: postgresql+asyncpg://" in block, (
        "the authoritative backend regression must run on PostgreSQL; "
        "staging and production forbid SQLite by policy"
    )
    assert "sqlite+aiosqlite" not in block


def test_full_regression_uses_its_own_database():
    """The Alembic step must still start from an empty schema."""
    block = _job_block("backend-complete")

    assert "renova_suite" in block
    assert "CREATE DATABASE renova_suite" in block
    # The Alembic upgrade proves a clean migration chain on the other database.
    assert "127.0.0.1:5433/renova\n" in block or "5433/renova\n" in block


@pytest.mark.parametrize(
    "job",
    [
        "chat-message-contracts",
        "project-creation-contracts",
        "acceptance-decision-contracts",
        "stage-mutation-contracts",
        "team-lifecycle-contracts",
    ],
)
def test_the_sqlite_path_is_still_exercised(job: str):
    """Moving the main run must not leave app/db/sqlite_compat.py untested."""
    assert "sqlite+aiosqlite" in _job_block(job)


def test_sqlite_compatibility_module_is_still_present():
    module = (
        Path(__file__).resolve().parents[1] / "app" / "db" / "sqlite_compat.py"
    )

    assert module.is_file(), "the bounded local/test SQLite path is still supported"
