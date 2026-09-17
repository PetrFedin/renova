"""A body-supplied child id must be proven to belong to the path project.

`require_project` authorises the project in the *path*. It says nothing about a
`room_id`/`stage_id`/`payment_id` arriving in the request *body*, and a foreign
key only guarantees the referenced row exists — not that it is ours. Without an
explicit check a contractor authorised on project A can bind a record to a row
of project B.

Two things are asserted here: that `app.api.scoping` actually fences a foreign
id, and that the repository-wide AST check both catches a real violation and
stays quiet on correct code. A check that cries wolf gets switched off, so the
false-positive direction is tested as deliberately as the true-positive one.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.scoping import scoped, scoped_all, scoped_id
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.entities import Project, Room, User, UserRole

import app.models  # noqa: F401 — register every mapped table

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

import check_project_scoped_references as checker  # noqa: E402


@pytest.fixture
async def two_projects():
    """Idempotent: the SQLite file is shared across tests in one run."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        await db.merge(
            User(
                id="scope-owner",
                phone="+79990000001",
                full_name="Owner",
                role=UserRole.customer,
            )
        )
        for project_id, name, address in (
            ("project-ours", "Ours", "A"),
            ("project-theirs", "Theirs", "B"),
        ):
            await db.merge(
                Project(
                    id=project_id,
                    name=name,
                    address=address,
                    renovation_type="cosmetic",
                    customer_id="scope-owner",
                )
            )
        for room_id, project_id, name in (
            ("room-ours", "project-ours", "Kitchen"),
            ("room-theirs", "project-theirs", "Foreign"),
        ):
            await db.merge(
                Room(
                    id=room_id,
                    project_id=project_id,
                    name=name,
                    length_m=3,
                    width_m=3,
                )
            )
        await db.commit()
    yield


# --- the helper --------------------------------------------------------------


async def test_scoped_returns_a_row_that_belongs_to_the_project(two_projects):
    async with SessionLocal() as db:
        room = await scoped(db, Room, "room-ours", "project-ours")

    assert room is not None
    assert room.id == "room-ours"


async def test_scoped_rejects_a_row_from_another_project(two_projects):
    async with SessionLocal() as db:
        with pytest.raises(HTTPException) as raised:
            await scoped(db, Room, "room-theirs", "project-ours")

    assert raised.value.status_code == 404


async def test_a_foreign_row_is_indistinguishable_from_a_missing_one(two_projects):
    """Otherwise the response confirms another project's row exists."""
    async with SessionLocal() as db:
        with pytest.raises(HTTPException) as foreign:
            await scoped(db, Room, "room-theirs", "project-ours")
        with pytest.raises(HTTPException) as missing:
            await scoped(db, Room, "room-does-not-exist", "project-ours")

    assert foreign.value.status_code == missing.value.status_code
    assert foreign.value.detail == missing.value.detail


async def test_scoped_id_keeps_an_optional_reference_optional(two_projects):
    async with SessionLocal() as db:
        assert await scoped_id(db, Room, None, "project-ours") is None
        assert await scoped_id(db, Room, "", "project-ours") is None
        assert await scoped_id(db, Room, "room-ours", "project-ours") == "room-ours"


async def test_scoped_id_rejects_a_foreign_reference(two_projects):
    async with SessionLocal() as db:
        with pytest.raises(HTTPException):
            await scoped_id(db, Room, "room-theirs", "project-ours")


async def test_scoped_required_rejects_a_missing_reference(two_projects):
    async with SessionLocal() as db:
        with pytest.raises(HTTPException):
            await scoped(db, Room, None, "project-ours", required=True)


async def test_scoped_all_rejects_a_partially_foreign_batch(two_projects):
    async with SessionLocal() as db:
        assert await scoped_all(db, Room, ["room-ours"], "project-ours") == ["room-ours"]
        with pytest.raises(HTTPException):
            await scoped_all(db, Room, ["room-ours", "room-theirs"], "project-ours")


async def test_scoped_all_preserves_order_and_drops_duplicates(two_projects):
    async with SessionLocal() as db:
        result = await scoped_all(
            db, Room, ["room-ours", "room-ours"], "project-ours"
        )

    assert result == ["room-ours"]


async def test_scoping_a_model_without_the_column_is_a_programming_error(two_projects):
    """Fail loudly rather than silently letting an unscopable model through."""
    async with SessionLocal() as db:
        with pytest.raises(TypeError, match="project_id"):
            await scoped(db, User, "scope-owner", "project-ours")


# --- the repository-wide check ----------------------------------------------


_VIOLATION = """
from app.models.entities import SelectionItem

async def create(project_id: str, body, db):
    row = SelectionItem(project_id=project_id, room_id=body.room_id)
    db.add(row)
"""

_ASSIGNMENT_VIOLATION = """
async def update(project_id: str, body, row):
    row.stage_id = body.stage_id
"""

_SCOPED_CALL = """
from app.api.scoping import scoped_id
from app.models.entities import Room, SelectionItem

async def create(project_id: str, body, db):
    row = SelectionItem(
        project_id=project_id,
        room_id=await scoped_id(db, Room, body.room_id, project_id),
    )
"""

_SCOPED_VIA_LOCAL = """
from app.api.scoping import scoped_id
from app.models.entities import Room, SelectionItem

async def create(project_id: str, body, db):
    room_id = await scoped_id(db, Room, body.room_id, project_id)
    row = SelectionItem(project_id=project_id, room_id=room_id)
"""

_DELEGATES_TO_SERVICE = """
from app.services import calendar_mutation_service as calendar_mutations

async def create(body, db, user):
    return await calendar_mutations.create_item(db, actor=user, stage_id=body.stage_id)
"""


def test_check_catches_a_constructor_violation():
    findings = checker.scan_source(_VIOLATION, module="probe.py")

    assert [(module, field) for module, field, _line in findings] == [
        ("probe.py", "room_id")
    ]


def test_check_catches_an_attribute_assignment_violation():
    findings = checker.scan_source(_ASSIGNMENT_VIOLATION, module="probe.py")

    assert [(module, field) for module, field, _line in findings] == [
        ("probe.py", "stage_id")
    ]


@pytest.mark.parametrize(
    "source", [_SCOPED_CALL, _SCOPED_VIA_LOCAL, _DELEGATES_TO_SERVICE]
)
def test_check_stays_quiet_on_correct_code(source: str):
    assert checker.scan_source(source, module="probe.py") == []


def test_repository_has_no_unscoped_writes():
    findings = checker.scan()
    current = {(module, field) for module, field, _line in findings}

    assert current <= checker.KNOWN_UNSCOPED or not current, (
        "new unscoped body-supplied child id: "
        + ", ".join(f"{module}:{line} {field}" for module, field, line in findings)
    )


def test_the_baseline_is_empty_and_must_stay_that_way():
    assert checker.KNOWN_UNSCOPED == frozenset()
