"""Customer-owned management API for project contractor participants."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.models.project_participants import ProjectParticipant
from app.services import project_participant_service as participants

router = APIRouter(prefix="/projects/{project_id}/participants", tags=["project-participants"])


class ParticipantScopeIn(BaseModel):
    scope_type: Literal["stage", "room", "work_type"]
    scope_ref: str = Field(min_length=1, max_length=64)


class ParticipantCreateIn(BaseModel):
    contractor_id: str = Field(min_length=1, max_length=36)
    scopes: list[ParticipantScopeIn] = Field(default_factory=list, max_length=100)


class ParticipantScopesIn(BaseModel):
    scopes: list[ParticipantScopeIn] = Field(default_factory=list, max_length=100)


class ParticipantScopeOut(BaseModel):
    scope_type: str
    scope_ref: str


class ParticipantOut(BaseModel):
    id: str
    user_id: str
    full_name: str | None
    participant_role: str
    status: str
    is_current_lead: bool
    all_scope: bool
    can_manage_schedule: bool
    can_manage_commercial: bool
    can_manage_documents: bool
    scopes: list[ParticipantScopeOut]
    added_at: datetime
    removed_at: datetime | None


class ParticipantMutationOut(BaseModel):
    participant: ParticipantOut
    created: bool = False


def _participant_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {"project_not_found", "participant_not_found"}:
        status = 404
    elif code == "participant_customer_owner_only":
        status = 403
    elif code == "participant_contractor_invalid":
        status = 404
    elif code in {
        "participant_is_legacy_lead",
        "participant_legacy_lead_scope_managed_by_compatibility",
        "participant_legacy_lead_remove_forbidden",
    }:
        status = 409
    else:
        status = 422
    return HTTPException(status, detail={"code": code})


async def _owner_project(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, detail={"code": "project_not_found"})
    if user.role != UserRole.customer or project.customer_id != user.id:
        raise HTTPException(403, detail={"code": "participant_customer_owner_only"})
    return project


async def _participant_out(
    db: AsyncSession,
    *,
    project: Project,
    participant: ProjectParticipant,
) -> ParticipantOut:
    user = await db.get(User, participant.user_id)
    scopes = await participants.participant_scopes(db, participant.id)
    return ParticipantOut(
        id=participant.id,
        user_id=participant.user_id,
        full_name=user.full_name if user is not None else None,
        participant_role=participant.participant_role,
        status=participant.status,
        is_current_lead=(
            participant.status == "active"
            and participant.participant_role == "lead_contractor"
            and project.contractor_id == participant.user_id
        ),
        all_scope=participant.all_scope,
        can_manage_schedule=participant.can_manage_schedule,
        can_manage_commercial=participant.can_manage_commercial,
        can_manage_documents=participant.can_manage_documents,
        scopes=[
            ParticipantScopeOut(scope_type=row.scope_type, scope_ref=row.scope_ref)
            for row in scopes
        ],
        added_at=participant.added_at,
        removed_at=participant.removed_at,
    )


@router.get("", response_model=list[ParticipantOut])
async def list_participants(
    project_id: str,
    include_removed: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _owner_project(db, project_id=project_id, user=user)
    rows = await participants.list_project_participants(
        db,
        project_id=project_id,
        include_removed=include_removed,
    )
    return [
        await _participant_out(db, project=project, participant=row)
        for row in rows
    ]


@router.post("", response_model=ParticipantMutationOut)
async def add_participant(
    project_id: str,
    body: ParticipantCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _owner_project(db, project_id=project_id, user=user)
    try:
        participant, created = await participants.add_or_reactivate_contractor(
            db,
            project_id=project_id,
            actor_id=user.id,
            contractor_id=body.contractor_id,
            scopes=[scope.model_dump() for scope in body.scopes],
        )
    except ValueError as error:
        raise _participant_error(error) from error
    return ParticipantMutationOut(
        participant=await _participant_out(db, project=project, participant=participant),
        created=created,
    )


@router.patch("/{participant_id}/scopes", response_model=ParticipantOut)
async def replace_participant_scopes(
    project_id: str,
    participant_id: str,
    body: ParticipantScopesIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _owner_project(db, project_id=project_id, user=user)
    try:
        participant = await participants.replace_scopes(
            db,
            project_id=project_id,
            participant_id=participant_id,
            actor_id=user.id,
            scopes=[scope.model_dump() for scope in body.scopes],
        )
    except ValueError as error:
        raise _participant_error(error) from error
    return await _participant_out(db, project=project, participant=participant)


@router.delete("/{participant_id}", response_model=ParticipantOut)
async def remove_participant(
    project_id: str,
    participant_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _owner_project(db, project_id=project_id, user=user)
    try:
        participant = await participants.remove_contractor(
            db,
            project_id=project_id,
            participant_id=participant_id,
            actor_id=user.id,
        )
    except ValueError as error:
        raise _participant_error(error) from error
    return await _participant_out(db, project=project, participant=participant)
