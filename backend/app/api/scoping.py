"""One place to prove a child reference belongs to the authorised project.

``require_project`` authorises the project in the *path*. It says nothing about
the ``room_id``, ``stage_id``, ``payment_id`` or ``document_id`` that arrives in
the request *body*. A foreign key only guarantees the referenced row exists —
not that it belongs to this project. Without an explicit check a contractor
authorised on project A can attach a selection, expense, issue, reaction or
document to a row belonging to project B.

Before this module the repository had no shared helper: 124 hand-rolled checks
(68 ``.project_id != project_id``, 56 inline ``project_id == project_id``
filters) spread across routers and services, and every new route re-introduced
the gap. That is why the backlog carries a recurring stream of
"[P0 Security] Bind <thing> to path project" issues.

Use ``scoped`` when the handler needs the row, ``scoped_id`` when it only needs
to store a validated identifier.
"""
from __future__ import annotations

from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

ModelT = TypeVar("ModelT")

# Not found and not-in-this-project are answered identically on purpose: a
# distinguishable response would confirm the existence of another project's row.
_NOT_FOUND_DETAIL = "scoped_reference_not_found"


def _scope_column(model: type[Any], scope_field: str):
    column = getattr(model, scope_field, None)
    if column is None:
        raise TypeError(
            f"{model.__name__} has no {scope_field!r} column; it cannot be "
            "project-scoped through this helper"
        )
    return column


async def scoped(
    db: AsyncSession,
    model: type[ModelT],
    entity_id: str | None,
    project_id: str,
    *,
    scope_field: str = "project_id",
    required: bool = True,
) -> ModelT | None:
    """Load ``entity_id`` only if it belongs to ``project_id``.

    Returns ``None`` when ``entity_id`` is falsy and ``required`` is False, so an
    optional body reference stays optional. Raises 404 when the row does not
    exist *or* belongs to another project.
    """
    if not entity_id:
        if required:
            raise HTTPException(404, _NOT_FOUND_DETAIL)
        return None

    column = _scope_column(model, scope_field)
    result = await db.execute(
        select(model).where(model.id == entity_id, column == project_id).limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, _NOT_FOUND_DETAIL)
    return row


async def scoped_id(
    db: AsyncSession,
    model: type[Any],
    entity_id: str | None,
    project_id: str,
    *,
    scope_field: str = "project_id",
    required: bool = False,
) -> str | None:
    """Validate a child reference and give back the identifier itself.

    The common shape for an optional body field that is stored verbatim:

        room_id = await scoped_id(db, Room, body.room_id, project_id)
    """
    if not entity_id and not required:
        return None

    column = _scope_column(model, scope_field)
    result = await db.execute(
        select(model.id).where(model.id == entity_id, column == project_id).limit(1)
    )
    found = result.scalar_one_or_none()
    if found is None:
        raise HTTPException(404, _NOT_FOUND_DETAIL)
    return found


async def scoped_all(
    db: AsyncSession,
    model: type[Any],
    entity_ids: list[str] | tuple[str, ...] | None,
    project_id: str,
    *,
    scope_field: str = "project_id",
) -> list[str]:
    """Validate a batch of child references in one round trip.

    Raises 404 if *any* identifier is unknown or belongs to another project, so
    a partially foreign batch can never be half-applied.
    """
    wanted = [entity_id for entity_id in (entity_ids or []) if entity_id]
    if not wanted:
        return []

    column = _scope_column(model, scope_field)
    result = await db.execute(
        select(model.id).where(model.id.in_(wanted), column == project_id)
    )
    found = {row for row in result.scalars().all()}
    if found != set(wanted):
        raise HTTPException(404, _NOT_FOUND_DETAIL)
    # Preserve caller order, drop duplicates.
    seen: set[str] = set()
    ordered: list[str] = []
    for entity_id in wanted:
        if entity_id not in seen:
            seen.add(entity_id)
            ordered.append(entity_id)
    return ordered
