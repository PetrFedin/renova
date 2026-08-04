"""Fail-fast database revision guard for working environments.

Staging and production must never serve traffic against a schema that differs
from the Alembic graph bundled with the running application.  The guard uses
Alembic's own migration context and script directory instead of ORM metadata,
so ``create_all`` cannot hide a missing or stale migration.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import AsyncEngine


_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_ROOT / "alembic.ini"
_ALEMBIC_SCRIPTS = _BACKEND_ROOT / "alembic"


class DatabaseRevisionError(RuntimeError):
    """Raised before startup when the database is not at the bundled head."""


@dataclass(frozen=True)
class DatabaseRevisionState:
    expected_heads: tuple[str, ...]
    current_heads: tuple[str, ...]

    @property
    def is_current(self) -> bool:
        return self.current_heads == self.expected_heads


def bundled_alembic_heads() -> tuple[str, ...]:
    """Return deterministic heads from the migration graph shipped with code."""
    if not _ALEMBIC_INI.is_file():
        raise DatabaseRevisionError(
            f"Alembic config is missing from the application image: {_ALEMBIC_INI}"
        )
    if not _ALEMBIC_SCRIPTS.is_dir():
        raise DatabaseRevisionError(
            f"Alembic scripts are missing from the application image: {_ALEMBIC_SCRIPTS}"
        )

    config = Config(str(_ALEMBIC_INI))
    # Alembic otherwise resolves a relative script_location against process
    # cwd, which is deployment-specific.  Bind it to this packaged backend.
    config.set_main_option("script_location", str(_ALEMBIC_SCRIPTS))
    heads = tuple(sorted(ScriptDirectory.from_config(config).get_heads()))
    if not heads:
        raise DatabaseRevisionError("Bundled Alembic graph has no head revision")
    return heads


def _database_heads(sync_connection) -> tuple[str, ...]:
    context = MigrationContext.configure(sync_connection)
    return tuple(sorted(context.get_current_heads()))


async def inspect_database_revision(engine: AsyncEngine) -> DatabaseRevisionState:
    """Read bundled and database heads without mutating schema or data."""
    expected = bundled_alembic_heads()
    async with engine.connect() as connection:
        current = await connection.run_sync(_database_heads)
    return DatabaseRevisionState(
        expected_heads=expected,
        current_heads=current,
    )


def _format_heads(heads: tuple[str, ...]) -> str:
    return ", ".join(heads) if heads else "<none>"


async def assert_database_at_head(engine: AsyncEngine) -> DatabaseRevisionState:
    """Raise with an actionable, non-secret message unless DB exactly matches code."""
    state = await inspect_database_revision(engine)
    if state.is_current:
        return state

    expected = set(state.expected_heads)
    current = set(state.current_heads)
    missing = tuple(sorted(expected - current))
    unexpected = tuple(sorted(current - expected))
    details: list[str] = [
        "Database schema revision mismatch",
        f"expected={_format_heads(state.expected_heads)}",
        f"current={_format_heads(state.current_heads)}",
    ]
    if missing:
        details.append(f"missing={_format_heads(missing)}")
    if unexpected:
        details.append(f"unexpected={_format_heads(unexpected)}")
    details.append("run `python -m alembic upgrade head` before starting the API")
    raise DatabaseRevisionError("; ".join(details))
