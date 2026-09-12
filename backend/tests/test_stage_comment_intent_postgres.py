"""Physical PostgreSQL same-key race for #398 stage comments."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, Stage, StageComment, StageStatus, User, UserRole
from app.services import stage_comment_intent as comment_svc


async def _count(db, model, *where):
    return await db.scalar(select(func.count()).select_from(model).where(*where))


@pytest.mark.asyncio
async def test_stage_comment_same_key_postgres_race_creates_one_comment(monkeypatch):
    url = os.environ.get("CHAT_COMMAND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("CHAT_COMMAND_POSTGRES_URL is required by the dedicated migrated-PostgreSQL gate")
    assert url.startswith("postgresql+asyncpg://"), "race proof must use real PostgreSQL"
    engine = create_async_engine(url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    stage_id = str(uuid.uuid4())
    try:
        async with Session() as setup:
            assert (await setup.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
            setup.add(User(id=user_id, phone=f"+794{uuid.uuid4().int % 100000000:08d}", role=UserRole.customer))
            await setup.flush()
            setup.add(Project(id=project_id, name="Stage comment race", renovation_type="cosmetic", customer_id=user_id))
            await setup.flush()
            setup.add(Stage(id=stage_id, project_id=project_id, name="Race stage", status=StageStatus.active))
            await setup.commit()

        original = comment_svc.commit_client_write
        ready = 0
        both_ready = asyncio.Event()
        release = asyncio.Event()
        guard = asyncio.Lock()

        async def synchronized_commit(*args, **kwargs):
            nonlocal ready
            async with guard:
                ready += 1
                if ready == 2:
                    both_ready.set()
            await asyncio.wait_for(release.wait(), 10)
            return await original(*args, **kwargs)

        monkeypatch.setattr(comment_svc, "commit_client_write", synchronized_commit)

        async def create_one():
            async with Session() as db:
                comment = await comment_svc.create_comment(
                    db,
                    project_id=project_id,
                    stage_id=stage_id,
                    user_id=user_id,
                    author_role="customer",
                    client_request_id="stage-comment-postgres-race-001",
                    text="Race comment",
                )
                return comment.id

        first = asyncio.create_task(create_one())
        second = asyncio.create_task(create_one())
        try:
            await asyncio.wait_for(both_ready.wait(), 10)
            release.set()
            first_id, second_id = await asyncio.wait_for(asyncio.gather(first, second), 15)
            assert first_id == second_id
            async with Session() as db:
                assert await _count(db, StageComment, StageComment.stage_id == stage_id) == 1
                assert await _count(db, ClientWriteRequest, ClientWriteRequest.scope == comment_svc.SCOPE) == 1
        finally:
            release.set()
            for job in (first, second):
                if not job.done():
                    job.cancel()
            await asyncio.gather(first, second, return_exceptions=True)
    finally:
        await engine.dispose()
