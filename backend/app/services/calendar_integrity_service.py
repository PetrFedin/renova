"""Canonical calendar visibility and stage-to-calendar synchronization."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    CalendarItem,
    Project,
    ProjectViewer,
    Stage,
    Team,
    TeamMember,
    User,
    UserRole,
)


@dataclass(frozen=True)
class CalendarSyncResult:
    created: int
    updated: int
    deleted: int


def accessible_project_ids(user: User):
    viewer_projects = select(ProjectViewer.project_id).where(ProjectViewer.user_id == user.id)
    conditions = [
        Project.customer_id == user.id,
        Project.contractor_id == user.id,
        Project.id.in_(viewer_projects),
    ]
    if user.role == UserRole.contractor:
        team_owner_ids = (
            select(Team.owner_id)
            .join(TeamMember, TeamMember.team_id == Team.id)
            .where(TeamMember.user_id == user.id)
        )
        conditions.append(Project.contractor_id.in_(team_owner_ids))
    return select(Project.id).where(or_(*conditions))


def visible_items_query(user: User):
    """Personal events plus project events only while project access remains valid."""
    accessible = accessible_project_ids(user)
    return select(CalendarItem).where(
        or_(
            and_(CalendarItem.user_id == user.id, CalendarItem.project_id.is_(None)),
            and_(
                CalendarItem.project_id.is_not(None),
                CalendarItem.project_id.in_(accessible),
                or_(CalendarItem.user_id == user.id, CalendarItem.is_public.is_(True)),
            ),
        )
    )


async def visible_items(
    db: AsyncSession,
    *,
    user: User,
    project_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    limit: int | None = None,
) -> list[CalendarItem]:
    query = visible_items_query(user)
    if project_id is not None:
        query = query.where(CalendarItem.project_id == project_id)
    if start_at is not None:
        query = query.where(CalendarItem.end_at >= start_at)
    if end_at is not None:
        query = query.where(CalendarItem.start_at <= end_at)
    query = query.order_by(CalendarItem.start_at.asc(), CalendarItem.id.asc())
    if limit is not None:
        query = query.limit(limit)
    return list((await db.execute(query)).scalars().all())


async def _locked_project(db: AsyncSession, project_id: str) -> Project | None:
    query = select(Project).where(Project.id == project_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


def _stage_start(stage: Stage) -> datetime:
    return datetime.combine(stage.planned_start, time(hour=9), tzinfo=timezone.utc)


def _stage_end(stage: Stage) -> datetime:
    return datetime.combine(stage.planned_end or stage.planned_start, time(hour=18), tzinfo=timezone.utc)


def _same_value(current, desired) -> bool:
    if isinstance(current, datetime) and isinstance(desired, datetime):
        current_utc = current.replace(tzinfo=timezone.utc) if current.tzinfo is None else current.astimezone(timezone.utc)
        desired_utc = desired.replace(tzinfo=timezone.utc) if desired.tzinfo is None else desired.astimezone(timezone.utc)
        return current_utc == desired_utc
    return current == desired


def _apply_stage_projection(item: CalendarItem, stage: Stage, project_id: str) -> bool:
    desired = {
        "title": stage.name,
        "description": "Этап проекта",
        "start_at": _stage_start(stage),
        "end_at": _stage_end(stage),
        "all_day": True,
        "event_type": "stage",
        "color": "#4F46E5",
        "is_public": True,
        "project_id": project_id,
        "stage_id": stage.id,
    }
    changed = False
    for field, value in desired.items():
        if not _same_value(getattr(item, field), value):
            setattr(item, field, value)
            changed = True
    return changed


async def sync_project_stages(
    db: AsyncSession,
    *,
    project_id: str,
    actor: User,
) -> CalendarSyncResult | None:
    from app.services import team_service

    project = await _locked_project(db, project_id)
    if project is None:
        await db.rollback()
        return None
    if not await team_service.can_access_project(db, actor, project, write=True):
        await db.rollback()
        raise ValueError("calendar_sync_forbidden")

    stages = list((await db.execute(select(Stage).where(Stage.project_id == project.id).order_by(Stage.sort_order.asc(), Stage.id.asc()))).scalars().all())
    existing = list((await db.execute(select(CalendarItem).where(CalendarItem.user_id == actor.id, CalendarItem.project_id == project.id, CalendarItem.stage_id.is_not(None)).order_by(CalendarItem.stage_id.asc(), CalendarItem.created_at.asc(), CalendarItem.id.asc()))).scalars().all())
    by_stage: dict[str, list[CalendarItem]] = {}
    for item in existing:
        if item.stage_id:
            by_stage.setdefault(item.stage_id, []).append(item)

    created = updated = deleted = 0
    active_stage_ids: set[str] = set()
    try:
        for stage in stages:
            if stage.planned_start is None:
                continue
            active_stage_ids.add(stage.id)
            candidates = by_stage.get(stage.id, [])
            if candidates:
                canonical = candidates[0]
                if _apply_stage_projection(canonical, stage, project.id):
                    updated += 1
                for duplicate in candidates[1:]:
                    await db.delete(duplicate)
                    deleted += 1
            else:
                item = CalendarItem(user_id=actor.id)
                _apply_stage_projection(item, stage, project.id)
                db.add(item)
                created += 1
        for stage_id, candidates in by_stage.items():
            if stage_id not in active_stage_ids:
                for stale in candidates:
                    await db.delete(stale)
                    deleted += 1
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return CalendarSyncResult(created=created, updated=updated, deleted=deleted)
