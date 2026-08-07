"""Project profile ORM fields kept outside the legacy entities monolith.

`projects.customer_budget` already exists in Alembic revision k1l2m3n4o5p6.
This module restores the missing ORM mapping without creating a duplicate
column or a second source of truth.
"""
from __future__ import annotations

from sqlalchemy import Float
from sqlalchemy.orm import mapped_column

from app.models.entities import Project


def register_project_profile_fields() -> None:
    """Attach migrated profile columns that drifted out of the legacy model."""
    if "customer_budget" not in Project.__table__.c:
        # DeclarativeMeta registers late mapped_column assignments on both the
        # Table and Mapper. Explicit SQL type/name keep this independent from
        # runtime type annotations in the legacy monolith.
        setattr(
            Project,
            "customer_budget",
            mapped_column("customer_budget", Float, nullable=True),
        )


register_project_profile_fields()
