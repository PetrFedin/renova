"""Physical PostgreSQL lock contention on migrated schema; never SQLite proof."""
from __future__ import annotations

import asyncio
import os

from fastapi import HTTPException
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.entities import ChatMessage, Payment, Project, WorkOrder
from app.models.client_write_request import ClientWriteRequest
from app.services import chat_business_commands as commands, chat_message_mutation as messages, chat_service
from app.services.client_write_idempotency import IdempotencyConflict
from test_chat_business_commands import seed, invoice, task, count
from test_stage_comment_intent_postgres import test_stage_comment_same_key_postgres_race_creates_one_comment


@pytest.fixture
async def postgres(monkeypatch):
    url = os.environ.get("CHAT_COMMAND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("CHAT_COMMAND_POSTGRES_URL is required by the dedicated migrated-PostgreSQL gate")
    assert url.startswith("postgresql+asyncpg://"), "race proof must use real PostgreSQL"
    engine = create_async_engine(url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async def no_ws(**kwargs):
        return None
    async def no_provider(*args, **kwargs):
        raise AssertionError("provider activation is forbidden in this slice")
    monkeypatch.setattr(messages, "_broadcast_after_commit", no_ws)
    monkeypatch.setattr(messages.outbox_inline_dispatch, "dispatch_best_effort", no_provider)
    async with Session() as db:
        assert (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        s = await seed(db)
    try:
        yield engine, Session, s
    finally:
        await engine.dispose()


async def assert_blocked(engine, pid):
    # Observe the actual database lock, rather than treating gather() as proof.
    async with engine.connect() as conn:
        for _ in range(100):
            blockers = await conn.scalar(text("SELECT cardinality(pg_blocking_pids(:pid))"), {"pid": pid})
            if blockers:
                return
            await asyncio.sleep(0.03)
    raise AssertionError("second PostgreSQL session never contended on the first transaction")


@pytest.mark.asyncio
@pytest.mark.parametrize("kind, changed", [("invoice", False), ("task", False), ("invoice", True), ("task", True)])
async def test_real_overlapping_command_transactions(postgres, monkeypatch, kind, changed):
    engine, Session, s = postgres
    held, release, second_started = asyncio.Event(), asyncio.Event(), asyncio.Event()
    prepare = messages.prepare_message
    entered = 0
    second_pid = None
    async def pause_first(*args, **kwargs):
        nonlocal entered
        entered += 1
        if entered == 1:
            held.set()
            await asyncio.wait_for(release.wait(), 10)
        return await prepare(*args, **kwargs)
    monkeypatch.setattr(messages, "prepare_message", pause_first)
    operation = invoice if kind == "invoice" else task
    async def first():
        async with Session() as db:
            result = await operation(db, s)
            return result.id
    async def second():
        nonlocal second_pid
        async with Session() as db:
            second_pid = await db.scalar(text("SELECT pg_backend_pid()"))
            second_started.set()
            overrides = {}
            if changed:
                overrides = {"amount": 999} if kind == "invoice" else {"client_request_id": "distinct-competing-task-key"}
            result = await operation(db, s, **overrides)
            return result.id
    first_job = asyncio.create_task(first())
    second_job = None
    try:
        await asyncio.wait_for(held.wait(), 10)
        second_job = asyncio.create_task(second())
        await asyncio.wait_for(second_started.wait(), 5)
        await assert_blocked(engine, second_pid)
        release.set()
        first_id = await asyncio.wait_for(first_job, 10)
        if changed:
            exception = IdempotencyConflict if kind == "invoice" else ValueError
            match = "idempotency_conflict" if kind == "invoice" else "chat_source_already_has_task"
            with pytest.raises(exception, match=match):
                await asyncio.wait_for(second_job, 10)
        else:
            assert await asyncio.wait_for(second_job, 10) == first_id
        async with Session() as db:
            model = Payment if kind == "invoice" else WorkOrder
            assert await count(db, model, model.project_id == s.project) == 1
            assert await count(db, ClientWriteRequest, ClientWriteRequest.project_id == s.project) == 1
            assert await count(db, ChatMessage, ChatMessage.thread_id == s.thread) == 2
    finally:
        release.set()
        jobs = [job for job in (first_job, second_job) if job is not None]
        for job in jobs:
            if not job.done():
                job.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)


@pytest.mark.asyncio
async def test_authority_is_refreshed_after_waiting_for_project_lock(postgres):
    engine, Session, s = postgres
    started = asyncio.Event()
    pid = None
    async with Session() as owner, Session() as stale:
        # Explicitly load stale identity-map state before the competing change.
        await stale.get(Project, s.project)
        project = await owner.scalar(select(Project).where(Project.id == s.project).with_for_update())
        project.contractor_id = s.outsider
        await owner.flush()
        async def old_contractor():
            nonlocal pid
            pid = await stale.scalar(text("SELECT pg_backend_pid()"))
            started.set()
            return await invoice(stale, s)
        job = asyncio.create_task(old_contractor())
        try:
            await asyncio.wait_for(started.wait(), 5)
            await assert_blocked(engine, pid)
            await owner.commit()
            with pytest.raises(HTTPException) as denied:
                await asyncio.wait_for(job, 10)
            assert denied.value.status_code == 403
            assert await count(stale, Payment, Payment.project_id == s.project) == 0
        finally:
            await owner.rollback()
            if not job.done():
                job.cancel()
            await asyncio.gather(job, return_exceptions=True)


@pytest.mark.asyncio
async def test_reaction_waits_for_task_link_and_preserves_both_json_fields(postgres, monkeypatch):
    engine, Session, s = postgres
    held, release, started = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original = commands.commit_client_write
    pid = None
    async def pause_commit(*args, **kwargs):
        held.set()
        await asyncio.wait_for(release.wait(), 10)
        return await original(*args, **kwargs)
    monkeypatch.setattr(commands, "commit_client_write", pause_commit)
    # WS for this legacy reaction runs only after commit; no provider is activated.
    from app.api.v1 import ws
    async def no_broadcast(*args, **kwargs):
        return None
    monkeypatch.setattr(ws, "broadcast", no_broadcast)
    async def create():
        async with Session() as db:
            message = await task(db, s)
            return chat_service.msg_dict(message)["work_order_id"]
    async def react():
        nonlocal pid
        async with Session() as db:
            await db.get(ChatMessage, s.source)
            pid = await db.scalar(text("SELECT pg_backend_pid()"))
            started.set()
            return await chat_service.toggle_reaction(db, s.source, s.contractor, "yes")
    creator = asyncio.create_task(create())
    reaction = None
    try:
        await asyncio.wait_for(held.wait(), 10)
        reaction = asyncio.create_task(react())
        await asyncio.wait_for(started.wait(), 5)
        await assert_blocked(engine, pid)
        release.set()
        work_id = await asyncio.wait_for(creator, 10)
        await asyncio.wait_for(reaction, 10)
        async with Session() as db:
            source = await db.get(ChatMessage, s.source)
            meta = chat_service._parse_meta(source.meta_json)
            assert meta["linked_task_id"] == work_id
            assert meta["reactions"]["yes"] == [s.contractor]
            assert meta["reactions"]["ok"] == [s.customer]
    finally:
        release.set()
        jobs = [job for job in (creator, reaction) if job is not None]
        for job in jobs:
            if not job.done():
                job.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)
