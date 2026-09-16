"""Atomic and response-loss-safe iCalendar import."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Stage, User
from app.services.client_write_idempotency import commit_client_write, replay_entity_id

SCOPE = "calendar.import"
_RESULT_RE = re.compile(r"^p(\d{8})u(\d{8})$")


@dataclass(frozen=True)
class ParsedEvent:
    title: str
    event_date: date
    uid: str


@dataclass(frozen=True)
class StageAssignment:
    stage_id: str
    event_date: date
    uid: str


def canonicalize_content(content: str) -> str:
    return content.replace("\r\n", "\n").replace("\r", "\n").strip()


def parse_events(content: str) -> list[ParsedEvent]:
    events: list[ParsedEvent] = []
    summary: str | None = None
    current_uid: str | None = None
    for raw_line in canonicalize_content(content).split("\n"):
        line = raw_line.strip()
        if line.startswith("UID:"):
            current_uid = line[4:].strip()
        elif line.startswith("SUMMARY:"):
            summary = line[8:]
        elif line.startswith("DTSTART"):
            raw = line.split(":", 1)[-1][:8]
            if len(raw) == 8:
                event_date = date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
                events.append(
                    ParsedEvent(
                        title=summary or "Event",
                        event_date=event_date,
                        uid=(current_uid or "").strip(),
                    )
                )
            current_uid = None
            summary = None
    return events


def _encode_result(parsed: int, updated: int) -> str:
    if not (0 <= parsed <= 99_999_999 and 0 <= updated <= 99_999_999):
        raise ValueError("calendar_import_result_overflow")
    return f"p{parsed:08d}u{updated:08d}"


def _decode_result(value: str) -> tuple[int, int]:
    match = _RESULT_RE.fullmatch(value or "")
    if not match:
        raise RuntimeError("calendar_import_replay_result_invalid")
    return int(match.group(1)), int(match.group(2))


async def _lock_project(db: AsyncSession, project_id: str) -> Project:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise RuntimeError("calendar_import_project_missing")
    return project


async def _revalidate_authority(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str,
) -> None:
    from fastapi import HTTPException
    from app.services import team_service as team_svc

    actor = await db.get(User, user_id, populate_existing=True)
    if actor is None or getattr(actor, "deleted_at", None):
        raise HTTPException(403, "project_forbidden")
    if not await team_svc.can_access_project(db, actor, project, write=True):
        raise HTTPException(403, "project_forbidden")


async def _locked_project_stages(db: AsyncSession, project_id: str) -> list[Stage]:
    result = await db.execute(
        select(Stage)
        .where(Stage.project_id == project_id)
        .order_by(Stage.sort_order.asc(), Stage.id.asc())
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


def build_assignments(stages: list[Stage], events: list[ParsedEvent]) -> list[StageAssignment]:
    """Resolve the whole import against one immutable pre-mutation stage snapshot."""
    originally_empty = {stage.id: stage.planned_start is None for stage in stages}
    unavailable_for_fallback: set[str] = set()
    assignments: list[StageAssignment] = []

    for event in events:
        stage: Stage | None = None
        if event.uid:
            stage = next(
                (
                    candidate
                    for candidate in stages
                    if candidate.ical_uid == event.uid or event.uid.endswith(candidate.id)
                ),
                None,
            )
        if stage is None and event.title:
            title = event.title.casefold()
            stage = next(
                (
                    candidate
                    for candidate in stages
                    if candidate.name.casefold() in title or title in candidate.name.casefold()
                ),
                None,
            )
        if stage is None:
            stage = next(
                (
                    candidate
                    for candidate in stages
                    if originally_empty[candidate.id] and candidate.id not in unavailable_for_fallback
                ),
                None,
            )
        if stage is None:
            continue

        assignments.append(
            StageAssignment(
                stage_id=stage.id,
                event_date=event.event_date,
                uid=event.uid,
            )
        )
        unavailable_for_fallback.add(stage.id)

    return assignments


async def import_ical(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    client_request_id: str,
    content: str,
) -> tuple[dict[str, int | bool], bool]:
    """Apply one ICS import intent atomically and replay its original result."""
    canonical_content = canonicalize_content(content)
    payload = {"content": canonical_content}
    try:
        project = await _lock_project(db, project_id)
        await _revalidate_authority(db, project=project, user_id=user_id)

        replay_id = await replay_entity_id(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            parsed, updated = _decode_result(replay_id)
            await db.commit()
            return {"ok": True, "parsed": parsed, "updated_stages": updated}, True

        events = parse_events(canonical_content)
        stages = await _locked_project_stages(db, project_id)
        assignments = build_assignments(stages, events)
        stages_by_id = {stage.id: stage for stage in stages}

        for assignment in assignments:
            stage = stages_by_id[assignment.stage_id]
            stage.planned_start = assignment.event_date
            stage.planned_end = assignment.event_date
            if assignment.uid:
                stage.ical_uid = assignment.uid
            elif not stage.ical_uid:
                # Preserve the legacy update_stage_dates invariant while
                # keeping the whole import inside one transaction: a stage
                # that receives a date from a UID-less external event still
                # needs a stable Renova-local iCalendar identity for export.
                stage.ical_uid = f"renova-{stage.id}@app"

        result_id = _encode_result(len(events), len(assignments))
        created, canonical_result_id = await commit_client_write(
            db,
            scope=SCOPE,
            project_id=project_id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=result_id,
        )
        if not created:
            parsed, updated = _decode_result(canonical_result_id)
            return {"ok": True, "parsed": parsed, "updated_stages": updated}, True
    except BaseException:
        await db.rollback()
        raise

    return {"ok": True, "parsed": len(events), "updated_stages": len(assignments)}, False
