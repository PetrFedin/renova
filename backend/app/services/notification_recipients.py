"""Единая функция «кому слать уведомление по событию проекта» (COM-005).

Раньше каждое место собирало получателей вручную как `{customer_id, contractor_id}`:
члены бригады исполнителя, технадзор и гости не получали ничего. Здесь правила
одни на всех:

* заказчик и ведущий исполнитель получают всё;
* прораб бригады — всё, кроме денег и договора;
* рядовой участник бригады — только по этапам, назначенным лично ему;
* наблюдатель бригады и гость проекта — события чата, графика, качества
  (читать можно), но НЕ деньги и НЕ договор;
* назначенный технадзор — чат, качество/приёмка, график; не деньги/договор;
* независимый исполнитель (ProjectParticipant) — по этапам своего scope.
"""
from __future__ import annotations

from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, ProjectViewer, Stage, Team, TeamMember, User

CHAT = "chat"
MONEY = "money"
CONTRACT = "contract"
QUALITY = "quality"
SCHEDULE = "schedule"
GENERAL = "general"

_MONEY_KINDS = {MONEY, CONTRACT}
_OBSERVER_KINDS = {CHAT, QUALITY, SCHEDULE, GENERAL}


async def project_recipients(
    db: AsyncSession,
    project: Project,
    kind: str,
    *,
    stage_id: str | None = None,
    exclude: Iterable[str | None] = (),
) -> set[str]:
    """Идентификаторы живых пользователей, которым положено событие `kind`."""
    ids: set[str] = set()
    if project.customer_id:
        ids.add(project.customer_id)
    if project.contractor_id:
        ids.add(project.contractor_id)

    if kind not in _MONEY_KINDS:
        stage = await db.get(Stage, stage_id) if stage_id else None
        if stage is not None and stage.project_id != project.id:
            stage = None

        if project.contractor_id:
            rows = (
                await db.execute(
                    select(TeamMember.user_id, TeamMember.role)
                    .join(Team, Team.id == TeamMember.team_id)
                    .where(Team.owner_id == project.contractor_id)
                )
            ).all()
            for user_id, role in rows:
                if role == "foreman":
                    ids.add(user_id)
                elif role == "viewer":
                    if kind in _OBSERVER_KINDS:
                        ids.add(user_id)
                elif role == "member":
                    if stage is not None and stage.assignee_id == user_id:
                        ids.add(user_id)

        if kind in _OBSERVER_KINDS:
            ids.update(
                (
                    await db.execute(
                        select(ProjectViewer.user_id).where(ProjectViewer.project_id == project.id)
                    )
                )
                .scalars()
                .all()
            )
            from app.services import technical_supervision_service as supervision

            assignment = await supervision.active_assignment(db, project.id)
            if assignment is not None and await supervision.is_active_supervisor(
                db, project_id=project.id, user_id=assignment.representative_user_id
            ):
                ids.add(assignment.representative_user_id)

        if stage is not None:
            from app.models.project_participants import ProjectParticipant
            from app.services import project_participant_service as part_svc

            participants = (
                await db.execute(
                    select(ProjectParticipant.user_id).where(
                        ProjectParticipant.project_id == project.id,
                        ProjectParticipant.status == "active",
                        ProjectParticipant.participant_role == "contractor",
                    )
                )
            ).scalars().all()
            for user_id in participants:
                if await part_svc.stage_assignee_allowed(db, project=project, stage=stage, user_id=user_id):
                    ids.add(user_id)

    ids.discard(None)  # type: ignore[arg-type]
    for skip in exclude:
        ids.discard(skip)  # type: ignore[arg-type]
    if not ids:
        return set()
    alive = (
        await db.execute(select(User.id).where(User.id.in_(list(ids)), User.deleted_at.is_(None)))
    ).scalars().all()
    return set(alive)


async def project_member_ids_for(
    db: AsyncSession, project: Project, kind: str, *, stage_id: str | None = None
) -> list[str]:
    """Отсортированный список (стабильный порядок для outbox/тестов)."""
    return sorted(await project_recipients(db, project, kind, stage_id=stage_id))
