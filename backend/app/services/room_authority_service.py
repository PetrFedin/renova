"""Authoritative room-edit capability shared by mutations and project read models."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User, UserRole
from app.models.project_participants import PARTICIPANT_ROLES, ProjectParticipant
from app.services import team_service


@dataclass(frozen=True)
class RoomAuthorityDescriptor:
    has_active_executor: bool
    direct_edit_allowed: bool


async def has_active_executor(db: AsyncSession, project: Project) -> bool:
    """Return product truth, not only the legacy ``Project.contractor_id`` flag.

    ``Project.contractor_id`` remains the compatibility lead during the
    multi-contractor migration. Independent active contractor principals live in
    ``ProjectParticipant`` and must also transfer room-change authority away
    from the customer-owner.
    """
    if project.contractor_id:
        return True
    participant_id = await db.scalar(
        select(ProjectParticipant.id)
        .where(
            ProjectParticipant.project_id == project.id,
            ProjectParticipant.status == "active",
            ProjectParticipant.participant_role.in_(tuple(PARTICIPANT_ROLES)),
        )
        .limit(1)
    )
    return participant_id is not None


async def _contractor_can_write(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
) -> bool:
    if actor.role != UserRole.contractor or project.trashed_at is not None:
        return False
    mode, read_only = await team_service.project_access_mode(db, actor, project)
    return mode == "contractor" and not read_only


async def can_direct_create_room(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
) -> bool:
    """Room create remains contractor-scoped; GP1 customer rooms are created with the project."""
    return await _contractor_can_write(db, project=project, actor=actor)


async def can_direct_edit_room(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
) -> bool:
    """One fail-closed predicate for the direct room update surface.

    Customer-owner controls existing room geometry before execution is handed to
    any active contractor principal. After that transition, the customer uses
    room change requests. Contractor-side principals continue to follow the
    existing project/team write-access contract.
    """
    if project.trashed_at is not None:
        return False

    if actor.role == UserRole.customer:
        return (
            project.customer_id == actor.id
            and not await has_active_executor(db, project)
        )

    return await _contractor_can_write(db, project=project, actor=actor)


async def describe_room_authority(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
) -> RoomAuthorityDescriptor:
    active_executor = await has_active_executor(db, project)
    if project.trashed_at is not None:
        direct = False
    elif actor.role == UserRole.customer:
        direct = project.customer_id == actor.id and not active_executor
    else:
        direct = await _contractor_can_write(db, project=project, actor=actor)
    return RoomAuthorityDescriptor(
        has_active_executor=active_executor,
        direct_edit_allowed=direct,
    )
