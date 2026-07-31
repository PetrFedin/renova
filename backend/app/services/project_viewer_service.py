"""Atomic and idempotent project viewer access operations."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, ProjectViewer


async def _find_viewer(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
) -> ProjectViewer | None:
    return await db.scalar(
        select(ProjectViewer).where(
            ProjectViewer.project_id == project_id,
            ProjectViewer.user_id == user_id,
        )
    )


def has_intrinsic_project_access(project: Project, user_id: str) -> bool:
    """Owners and assigned project roles must not be duplicated as read-only guests."""
    return user_id in {
        getattr(project, "customer_id", None),
        getattr(project, "contractor_id", None),
        getattr(project, "foreman_id", None),
    }


async def grant_project_viewer(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
) -> tuple[ProjectViewer, bool]:
    """Create one viewer row, returning the existing row for retries and races."""
    existing = await _find_viewer(db, project_id=project_id, user_id=user_id)
    if existing is not None:
        return existing, False

    viewer = ProjectViewer(project_id=project_id, user_id=user_id)
    try:
        async with db.begin_nested():
            db.add(viewer)
            await db.flush()
    except IntegrityError:
        # A concurrent request committed the same unique pair. The savepoint rollback
        # keeps the outer request transaction usable for the canonical reread.
        existing = await _find_viewer(db, project_id=project_id, user_id=user_id)
        if existing is None:
            raise
        return existing, False

    await db.commit()
    return viewer, True
