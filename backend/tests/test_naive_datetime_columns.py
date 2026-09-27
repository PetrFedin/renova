"""An aware datetime must never be written into a naive column.

Every one of the 54 datetime columns in the models is declared as bare
``DateTime``, i.e. ``TIMESTAMP WITHOUT TIME ZONE``. None of them uses
``timezone=True``. asyncpg refuses a timezone-aware value for such a column:

    asyncpg.exceptions.DataError: invalid input for query argument $10:
    datetime.datetime(2026, 9, 20, 14, 38, 1, tzinfo=datetime.timezone.utc)
    (can't subtract offset-naive and offset-aware datetimes)

Three places in ``issue_service`` did exactly that, and the consequences were
not small: a defect could not be created at all (the only entry point in the
app is a marker on the floor plan) and, once fixed, could not be closed. Both
answered 500 on every request, for both roles, on every project.

The suite did not catch it because ``tests/conftest.py`` runs on
``sqlite+aiosqlite:///:memory:``, and SQLite accepts an aware datetime
happily. So the failure existed only where it mattered — PostgreSQL — and
nowhere the tests could see it.

Rather than pin those three lines, this walks the whole backend for the shape,
so the class cannot come back somewhere else. The codebase already has the
right helper: ``app.core.timeutil.utc_now()`` returns naive UTC and is used in
62 places.
"""

from __future__ import annotations

import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MODELS = BACKEND / "app" / "models"
APP = BACKEND / "app"

_COLUMN = re.compile(
    r"^\s*(\w+):\s*Mapped\[[^\]]*datetime[^\]]*\]\s*=\s*mapped_column\((?P<rest>.*)"
)
_AWARE_NOW = re.compile(r"datetime\.now\(\s*(?:tz\s*=\s*)?timezone\.utc\s*\)")
#   x.column = datetime.now(timezone.utc)      /      Model(column=datetime.now(...))
_ASSIGN = re.compile(r"(?:\.(\w+)|\b(\w+))\s*=\s*datetime\.now\(")


def _datetime_columns() -> tuple[set[str], set[str]]:
    """Column names declared as DateTime, split into naive and aware."""
    naive: set[str] = set()
    aware: set[str] = set()
    for path in sorted(MODELS.glob("*.py")):
        for line in path.read_text().splitlines():
            match = _COLUMN.match(line)
            if not match:
                continue
            rest = match.group("rest")
            if "DateTime" not in rest:
                continue
            (aware if "timezone=True" in rest else naive).add(match.group(1))
    # A name declared both ways somewhere cannot be judged by name alone.
    return naive - aware, aware


def _offenders() -> list[str]:
    naive, _ = _datetime_columns()
    found: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        if path.is_relative_to(MODELS):
            continue
        source = path.read_text()
        if "timezone.utc" not in source:
            continue
        for number, line in enumerate(source.splitlines(), 1):
            if not _AWARE_NOW.search(line):
                continue
            match = _ASSIGN.search(line)
            if not match:
                continue
            column = match.group(1) or match.group(2)
            if column in naive:
                found.append(
                    f"  {path.relative_to(BACKEND)}:{number}  [{column}]  {line.strip()[:100]}"
                )
    return found


def test_the_scan_has_something_to_scan():
    """Guards the guard: an empty column set would assert nothing."""
    naive, aware = _datetime_columns()

    assert len(naive) > 20, (
        f"expected the model layer's datetime columns, found {len(naive)} naive "
        f"and {len(aware)} aware — has models/ been restructured?"
    )


def test_no_aware_datetime_is_written_into_a_naive_column():
    offenders = _offenders()

    assert not offenders, (
        "a timezone-aware datetime is assigned to a column declared as bare "
        "DateTime. PostgreSQL rejects this with a DataError; SQLite, which this "
        "suite runs on, accepts it — so the failure appears only in production.\n"
        "Use app.core.timeutil.utc_now(), which returns naive UTC.\n\n"
        + "\n".join(offenders)
    )
