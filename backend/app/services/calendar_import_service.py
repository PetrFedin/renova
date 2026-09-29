"""Atomic, response-loss-safe iCalendar import (#422).

Bug fixed here: the previous inline parser in `app.api.v1.calendar` only read
`DTSTART` and silently dropped `DTEND`, so every imported event collapsed to
a single-day stage regardless of its real duration — corrupting the
project's schedule end dates on every import.

Response-loss safety: a lost response after a committed import must not
re-apply a different mapping on retry. The previous implementation looked up
"the first stage with no planned_start" *after* committing each preceding
stage's date one row at a time, so a replay of the same file could walk an
unmatched event onto a different fallback stage than the first attempt did,
or leave a de-facto partial import if the process died mid-loop (no
transaction spanned the whole file).

Fixed by:
  - Computing the complete event -> stage mapping from one snapshot of the
    project's stages (locked for update, scoped to the path project) taken
    *before* any mutation, tracking fallback-stage consumption locally so
    two unmatched events in the same file cannot collide.
  - Applying every stage mutation in one open transaction with no commit
    inside the loop, and committing the stage rows + the `IcalImportResult`
    evidence row + the `ClientWriteRequest` ledger row together, atomically.
  - Deriving the idempotency key from the canonical ICS content itself
    (`content_sha256`), scoped to (project, user): the import payload is the
    entire business intent, so a byte-identical retry after a lost response
    is by construction "the same request" and safely replays the original
    result. A caller-supplied `client_request_id` is honored when present
    (forward-compatible with a mobile client that mints one before first
    send per the issue's contract); reusing it with different content still
    raises IdempotencyConflict via the shared ledger. Content-hash keying
    was chosen over a bare client_request_id because the current mobile
    `calendarApi.importIcal()` sends no stable business identity at all
    (per issue #422), so the file's own checksum is the only intention
    signal actually available end to end.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_import import IcalImportResult
from app.models.entities import Project, Stage
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.client_write_side_effects import clear_request_side_effect_context

CALENDAR_IMPORT_SCOPE = "calendar.import"


@dataclass
class ParsedIcalEvent:
    title: str
    uid: str | None
    start: date
    end: date  # inclusive


def _parse_ical_date(raw: str) -> date | None:
    digits = raw.split(":", 1)[-1].strip()[:8]
    if len(digits) != 8 or not digits.isdigit():
        return None
    return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))


def parse_ical_events(content: str) -> list[ParsedIcalEvent]:
    """Parse VEVENT blocks, honoring both DTSTART and DTEND.

    All-day DTEND in iCalendar is exclusive (the day *after* the event
    ends), matching the convention this backend already uses on export in
    `export_ical()`. We convert it back to an inclusive end date so it is
    directly comparable to `Stage.planned_end`.
    """
    events: list[ParsedIcalEvent] = []
    in_event = False
    summary: str | None = None
    uid: str | None = None
    dtstart: date | None = None
    dtend_exclusive: date | None = None

    for raw_line in content.replace("\r", "").split("\n"):
        line = raw_line.strip()
        if line == "BEGIN:VEVENT":
            in_event = True
            summary = None
            uid = None
            dtstart = None
            dtend_exclusive = None
            continue
        if line == "END:VEVENT":
            if in_event and dtstart is not None:
                end_inclusive = dtstart
                if dtend_exclusive is not None:
                    candidate = dtend_exclusive - timedelta(days=1)
                    end_inclusive = candidate if candidate >= dtstart else dtstart
                events.append(
                    ParsedIcalEvent(
                        title=(summary or "Event").strip() or "Event",
                        uid=uid,
                        start=dtstart,
                        end=end_inclusive,
                    )
                )
            in_event = False
            continue
        if not in_event:
            continue
        if line.startswith("UID:"):
            uid = line[4:].strip()
        elif line.startswith("SUMMARY:"):
            summary = line[8:]
        elif line.startswith("DTSTART"):
            dtstart = _parse_ical_date(line)
        elif line.startswith("DTEND"):
            dtend_exclusive = _parse_ical_date(line)

    return events


def _match_stage(
    ev: ParsedIcalEvent,
    stages: list[Stage],
    consumed_fallback_ids: set[str],
) -> Stage | None:
    uid = ev.uid or ""
    if uid:
        for st in stages:
            if st.ical_uid == uid or uid.endswith(st.id):
                return st
    if ev.title:
        lowered = ev.title.lower()
        for st in stages:
            if st.name.lower() in lowered or lowered in st.name.lower():
                return st
    # Fallback: first stage with no planned_start, not already claimed by an
    # earlier event in *this same* import pass. Snapshot is taken once
    # up-front, so a replay of the identical file always recomputes the same
    # mapping from the same starting state instead of drifting onto whatever
    # a partially-applied prior attempt left behind.
    for st in stages:
        if not st.planned_start and st.id not in consumed_fallback_ids:
            return st
    return None


def canonical_import_payload(*, content_sha256: str) -> dict:
    return {"content_sha256": content_sha256}


async def import_ical_atomic(
    db: AsyncSession,
    *,
    project_id: str,
    actor_id: str,
    content: str,
    client_request_id: str | None = None,
) -> dict:
    """Parse + apply an .ics import in one atomic, replay-safe transaction.

    Returns {"ok": True, "parsed": N, "updated_stages": M, "replayed": bool}.
    Raises IdempotencyConflict (-> 409 at the API layer) if the caller reuses
    a client_request_id with different file content.
    """
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    request_id = client_request_id or f"sha256:{content_hash}"
    payload = canonical_import_payload(content_sha256=content_hash)

    try:
        replay_id = await replay_entity_id(
            db,
            scope=CALENDAR_IMPORT_SCOPE,
            project_id=project_id,
            user_id=actor_id,
            request_id=request_id,
            payload=payload,
        )
        if replay_id:
            existing = await db.get(IcalImportResult, replay_id)
            if not existing or existing.project_id != project_id:
                raise ValueError("calendar_import_idempotency_target_missing")
            return {
                "ok": True,
                "parsed": existing.parsed,
                "updated_stages": existing.updated_stages,
                "replayed": True,
            }

        events = parse_ical_events(content)

        # One project-scoped, locked snapshot of stages taken before any
        # mutation — the complete event->stage mapping is decided against
        # this single view, never against partially-mutated rows.
        stage_query = select(Stage).where(Stage.project_id == project_id)
        try:
            stage_query = stage_query.with_for_update()
        except Exception:
            pass
        stages = list((await db.execute(stage_query)).scalars().all())
        stages.sort(key=lambda s: s.sort_order)

        consumed_fallback_ids: set[str] = set()
        mapping: list[tuple[Stage, ParsedIcalEvent]] = []
        for ev in events:
            stage = _match_stage(ev, stages, consumed_fallback_ids)
            if stage is None:
                continue
            # All selected stages come from the query above, which is
            # already scoped to project_id — no cross-project row can be
            # selected here.
            consumed_fallback_ids.add(stage.id)
            mapping.append((stage, ev))

        updated = 0
        for stage, ev in mapping:
            stage.planned_start = ev.start
            stage.planned_end = ev.end
            if ev.uid:
                stage.ical_uid = ev.uid
            elif not getattr(stage, "ical_uid", None):
                stage.ical_uid = f"renova-{stage.id}@app"
            updated += 1

        result = IcalImportResult(
            project_id=project_id,
            content_sha256=content_hash,
            parsed=len(events),
            updated_stages=updated,
            mapping_json=json.dumps(
                [{"stage_id": st.id, "uid": ev.uid, "start": ev.start.isoformat(), "end": ev.end.isoformat()} for st, ev in mapping]
            ),
        )
        db.add(result)
        await db.flush()

        created, canonical_id = await commit_client_write(
            db,
            scope=CALENDAR_IMPORT_SCOPE,
            project_id=project_id,
            user_id=actor_id,
            request_id=request_id,
            payload=payload,
            entity_id=result.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise
    clear_request_side_effect_context()

    if not created:
        existing = await db.get(IcalImportResult, canonical_id)
        if not existing:
            raise ValueError("calendar_import_idempotency_target_missing")
        return {
            "ok": True,
            "parsed": existing.parsed,
            "updated_stages": existing.updated_stages,
            "replayed": True,
        }

    return {"ok": True, "parsed": result.parsed, "updated_stages": result.updated_stages, "replayed": False}
