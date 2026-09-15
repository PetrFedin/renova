from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, ProjectIssue, User, UserRole
from app.services import issue_create_service as issue_create


def _postgres_url() -> str:
    url = os.environ.get("CHAT_COMMAND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("CHAT_COMMAND_POSTGRES_URL is required by the dedicated migrated-PostgreSQL gate")
    assert url.startswith("postgresql+asyncpg://"), "race proof must use real PostgreSQL"
    return url


async def _disable_inline_dispatch(monkeypatch) -> None:
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*args, **kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)


async def _seed(Session, *, name: str) -> tuple[str, str, str]:
    customer_id = str(uuid.uuid4())
    contractor_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    async with Session() as db:
        assert (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        db.add_all([
            User(id=customer_id, phone=f"+799{uuid.uuid4().int % 100000000:08d}", role=UserRole.customer),
            User(id=contractor_id, phone=f"+798{uuid.uuid4().int % 100000000:08d}", role=UserRole.contractor),
        ])
        await db.flush()
        db.add(Project(
            id=project_id,
            name=name,
            renovation_type="cosmetic",
            customer_id=customer_id,
            contractor_id=contractor_id,
        ))
        await db.commit()
    return customer_id, contractor_id, project_id


@pytest.mark.asyncio
async def test_issue_same_key_postgres_race_creates_one_issue_and_effect_set(monkeypatch):
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    await _disable_inline_dispatch(monkeypatch)
    _customer_id, contractor_id, project_id = await _seed(Session, name="Issue PG race")

    # Prove two physical sessions arrive at the serialization boundary before
    # either is allowed to acquire the PostgreSQL project row lock.
    ready = 0
    both_ready = asyncio.Event()
    release = asyncio.Event()
    guard = asyncio.Lock()
    original_lock = issue_create._lock_project

    async def synchronized_lock(*args, **kwargs):
        nonlocal ready
        async with guard:
            ready += 1
            if ready == 2:
                both_ready.set()
        await asyncio.wait_for(release.wait(), 10)
        return await original_lock(*args, **kwargs)

    monkeypatch.setattr(issue_create, "_lock_project", synchronized_lock)
    payload = {
        "title": "Race crack",
        "description": "one intent",
        "room_id": None,
        "stage_id": None,
        "severity": "high",
        "floor_plan_id": None,
        "x_pct": None,
        "y_pct": None,
        "photo_key": None,
    }

    async def create_one():
        async with Session() as db:
            project = await db.get(Project, project_id)
            assert project is not None
            row, replayed = await issue_create.create_issue(
                db,
                project=project,
                user_id=contractor_id,
                client_request_id="issue-postgres-race-001",
                payload=payload,
            )
            return row.id, replayed

    first = asyncio.create_task(create_one())
    second = asyncio.create_task(create_one())
    try:
        await asyncio.wait_for(both_ready.wait(), 10)
        release.set()
        one, two = await asyncio.wait_for(asyncio.gather(first, second), 15)
        assert one[0] == two[0]
        assert {one[1], two[1]} == {False, True}

        async with Session() as db:
            rows = await db.scalar(select(func.count()).select_from(ProjectIssue).where(ProjectIssue.project_id == project_id))
            mappings = await db.scalar(select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.project_id == project_id,
                ClientWriteRequest.scope == issue_create.SCOPE,
            ))
            effects = await db.scalar(select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.aggregate_type == "project_issue",
                DomainOutbox.aggregate_id == one[0],
            ))
            assert rows == 1
            assert mappings == 1
            assert effects == 2
    finally:
        release.set()
        for job in (first, second):
            if not job.done():
                job.cancel()
        await asyncio.gather(first, second, return_exceptions=True)
        await engine.dispose()


@pytest.mark.asyncio
async def test_issue_create_rechecks_revoked_contractor_after_postgres_lock_wait(monkeypatch):
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    await _disable_inline_dispatch(monkeypatch)
    _customer_id, contractor_id, project_id = await _seed(Session, name="Issue revoke race")

    payload = {
        "title": "Must not survive revoked access",
        "description": "authority changes while creator waits",
        "room_id": None,
        "stage_id": None,
        "severity": "medium",
        "floor_plan_id": None,
        "x_pct": None,
        "y_pct": None,
        "photo_key": None,
    }

    async with Session() as creator_db, Session() as revoker_db:
        stale_project = await creator_db.get(Project, project_id)
        assert stale_project is not None
        assert stale_project.contractor_id == contractor_id

        locked_project = (
            await revoker_db.execute(
                select(Project).where(Project.id == project_id).with_for_update()
            )
        ).scalar_one()
        locked_project.contractor_id = None
        await revoker_db.flush()

        create_task = asyncio.create_task(
            issue_create.create_issue(
                creator_db,
                project=stale_project,
                user_id=contractor_id,
                client_request_id="issue-revoked-during-lock-001",
                payload=payload,
            )
        )
        try:
            # The creator must physically wait on the row lock held by the
            # revoker, not race ahead using its stale pre-lock Project object.
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(create_task), timeout=0.25)

            await revoker_db.commit()
            with pytest.raises(HTTPException) as forbidden:
                await asyncio.wait_for(create_task, timeout=10)
            assert forbidden.value.status_code == 403
        finally:
            if not create_task.done():
                create_task.cancel()
            await asyncio.gather(create_task, return_exceptions=True)
            if revoker_db.in_transaction():
                await revoker_db.rollback()

    async with Session() as db:
        assert await db.scalar(
            select(func.count()).select_from(ProjectIssue).where(ProjectIssue.project_id == project_id)
        ) == 0
        assert await db.scalar(
            select(func.count()).select_from(ClientWriteRequest).where(
                ClientWriteRequest.project_id == project_id,
                ClientWriteRequest.scope == issue_create.SCOPE,
            )
        ) == 0
        assert await db.scalar(
            select(func.count()).select_from(DomainOutbox).where(
                DomainOutbox.aggregate_type == "project_issue"
            )
        ) == 0

    await engine.dispose()
