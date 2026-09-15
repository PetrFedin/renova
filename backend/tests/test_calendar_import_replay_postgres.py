from __future__ import annotations

import asyncio
from datetime import date
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.services import calendar_import_service as import_svc


def _postgres_url() -> str:
    value = os.environ.get("CALENDAR_IMPORT_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("CALENDAR_IMPORT_POSTGRES_URL is only set by dedicated PostgreSQL workflow")
    return value


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _ics() -> str:
    return "\n".join(
        [
            "BEGIN:VCALENDAR",
            "BEGIN:VEVENT",
            "UID:calendar-external-race",
            "SUMMARY:External unmatched event",
            "DTSTART;VALUE=DATE:20261005",
            "END:VEVENT",
            "END:VCALENDAR",
        ]
    )


async def _seed(Session, *, contractor_actor: bool = False):
    customer_id = _id("ical-customer")
    contractor_id = _id("ical-contractor")
    project_id = _id("ical-project")
    first_id = _id("ical-stage-a")
    second_id = _id("ical-stage-b")
    async with Session() as db:
        db.add_all(
            [
                User(
                    id=customer_id,
                    phone=f"+79{uuid.uuid4().int % 10_000_000_000:010d}",
                    role=UserRole.customer,
                ),
                User(
                    id=contractor_id,
                    phone=f"+78{uuid.uuid4().int % 10_000_000_000:010d}",
                    role=UserRole.contractor,
                ),
            ]
        )
        await db.flush()
        db.add(
            Project(
                id=project_id,
                name="ICS PostgreSQL replay",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=contractor_id,
            )
        )
        db.add_all(
            [
                Stage(
                    id=first_id,
                    project_id=project_id,
                    name="Stage A",
                    sort_order=0,
                    status=StageStatus.planned,
                    percent_complete=0,
                ),
                Stage(
                    id=second_id,
                    project_id=project_id,
                    name="Stage B",
                    sort_order=1,
                    status=StageStatus.planned,
                    percent_complete=0,
                ),
            ]
        )
        await db.commit()
    return (
        contractor_id if contractor_actor else customer_id,
        contractor_id,
        project_id,
        first_id,
        second_id,
    )


async def _count(Session, model, *where) -> int:
    async with Session() as db:
        return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


@pytest.mark.asyncio
async def test_calendar_import_same_key_postgres_race_never_drifts_to_second_stage():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, _contractor_id, project_id, first_id, second_id = await _seed(Session)

    async def run_one():
        async with Session() as db:
            return await import_svc.import_ical(
                db,
                project_id=project_id,
                user_id=actor_id,
                client_request_id="calendar-import-pg-race-001",
                content=_ics(),
            )

    try:
        first_result, second_result = await asyncio.gather(run_one(), run_one())
        replay_flags = sorted([first_result[1], second_result[1]])
        assert replay_flags == [False, True]
        assert first_result[0] == second_result[0] == {
            "ok": True,
            "parsed": 1,
            "updated_stages": 1,
        }

        async with Session() as db:
            first = await db.get(Stage, first_id)
            second = await db.get(Stage, second_id)
            assert first is not None and second is not None
            assert first.planned_start == date(2026, 10, 5)
            assert first.ical_uid == "calendar-external-race"
            assert second.planned_start is None
            assert second.ical_uid is None

        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == import_svc.SCOPE,
        ) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_calendar_import_rechecks_revoked_contractor_after_project_lock_wait():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    actor_id, contractor_id, project_id, first_id, second_id = await _seed(
        Session,
        contractor_actor=True,
    )

    holder = Session()
    try:
        locked_project = (
            await holder.execute(
                select(Project).where(Project.id == project_id).with_for_update()
            )
        ).scalar_one()

        async def blocked_import():
            async with Session() as db:
                return await import_svc.import_ical(
                    db,
                    project_id=project_id,
                    user_id=actor_id,
                    client_request_id="calendar-import-pg-revoke-001",
                    content=_ics(),
                )

        task = asyncio.create_task(blocked_import())
        await asyncio.sleep(0.15)
        assert not task.done()

        assert locked_project.contractor_id == contractor_id
        locked_project.contractor_id = None
        await holder.commit()

        with pytest.raises(HTTPException) as denied:
            await task
        assert denied.value.status_code == 403

        async with Session() as db:
            first = await db.get(Stage, first_id)
            second = await db.get(Stage, second_id)
            assert first is not None and second is not None
            assert first.planned_start is None and first.ical_uid is None
            assert second.planned_start is None and second.ical_uid is None

        assert await _count(
            Session,
            ClientWriteRequest,
            ClientWriteRequest.project_id == project_id,
            ClientWriteRequest.scope == import_svc.SCOPE,
        ) == 0
    finally:
        await holder.close()
        await engine.dispose()
