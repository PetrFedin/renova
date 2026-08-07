"""Atomic persistence for the editable project profile."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project


PROFILE_FIELDS = frozenset(
    {
        "name",
        "address",
        "renovation_type",
        "property_type",
        "planned_start_date",
        "planned_end_date",
        "vat_rate",
        "customer_budget",
    }
)


async def update_project_profile(
    db: AsyncSession,
    project: Project,
    fields: Mapping[str, Any],
) -> Project:
    """Apply one validated profile patch and commit it as a single mutation."""
    unknown = set(fields) - PROFILE_FIELDS
    if unknown:
        raise ValueError(f"unsupported_project_profile_fields:{','.join(sorted(unknown))}")

    for key, value in fields.items():
        setattr(project, key, value)

    await db.commit()
    await db.refresh(project)
    return project
