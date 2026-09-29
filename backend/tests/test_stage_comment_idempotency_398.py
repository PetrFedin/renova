"""Issue #398: queued stage-comment creation must be replay-safe.

The mobile offline queue (apps/mobile/lib/offlineQueue.ts) can replay a lost/ambiguous
POST /projects/{project_id}/stages/{stage_id}/comments with the same `client_request_id`.
Before this fix, app.services.stage_service.add_comment had no consumer for that
identity, so a retried request could create a second StageComment.

These tests exercise the service layer directly (same pattern as
tests/test_offline_mutation_idempotency_316.py) and assert that two calls with the
same request_id + same canonical {stage_id, text} payload produce exactly one
StageComment, while the same request_id with a different payload is rejected as a
409 idempotency conflict, and different request_ids with identical text remain
distinct comments.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
from app.models.entities import Project, Stage, StageComment, StageStatus, User, UserRole
from app.services import stage_service as stage_svc
from app.services.client_write_idempotency import IdempotencyConflict


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(db):
    customer = User(
        id="b1111111-1111-1111-1111-111111111111",
        phone="+79990000201",
        role=UserRole.customer,
        full_name="Customer",
    )
    contractor = User(
        id="b2222222-2222-2222-2222-222222222222",
        phone="+79990000202",
        role=UserRole.contractor,
        full_name="Contractor",
    )
    project = Project(
        id="b3333333-3333-3333-3333-333333333333",
        name="Stage comment idempotency",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id="b4444444-4444-4444-4444-444444444444",
        project_id=project.id,
        name="Демонтаж",
        status=StageStatus.active,
    )
    db.add_all([customer, contractor, project, stage])
    await db.commit()
    return customer, contractor, project, stage


@pytest.fixture
async def session_env():
    engine, Session = await _session_factory()
    try:
        yield engine, Session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_same_request_id_and_payload_replays_one_comment(session_env):
    """Two identical queued POST .../comments with the same client_request_id must
    not create two StageComments — the second call replays the first result."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, stage = await _seed(db)

        kwargs = dict(
            stage_id=stage.id,
            user_id=customer.id,
            role=customer.role.value,
            text="Демонтаж завершён",
            project_id=project.id,
            client_request_id="offline-stage-comment-0001",
        )
        first = await stage_svc.add_comment(db, **kwargs)
        second = await stage_svc.add_comment(db, **kwargs)

        assert second.id == first.id
        comments = (
            await db.execute(select(StageComment).where(StageComment.stage_id == stage.id))
        ).scalars().all()
        assert len(comments) == 1
        assert comments[0].text == "Демонтаж завершён"


@pytest.mark.asyncio
async def test_same_request_id_different_payload_conflicts(session_env):
    """Same client_request_id with a changed canonical payload (text or stage) must
    raise IdempotencyConflict, never silently overwrite the earlier comment."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, stage = await _seed(db)
        # Capture identifiers before any rollback expires the ORM objects — an
        # expired attribute access outside an awaited DB call raises
        # MissingGreenlet under the async sqlite driver.
        stage_id, customer_id, customer_role, project_id = (
            stage.id,
            customer.id,
            customer.role.value,
            project.id,
        )

        await stage_svc.add_comment(
            db,
            stage_id=stage_id,
            user_id=customer_id,
            role=customer_role,
            text="Демонтаж завершён",
            project_id=project_id,
            client_request_id="offline-stage-comment-0002",
        )
        with pytest.raises(IdempotencyConflict):
            await stage_svc.add_comment(
                db,
                stage_id=stage_id,
                user_id=customer_id,
                role=customer_role,
                text="Совсем другой текст",
                project_id=project_id,
                client_request_id="offline-stage-comment-0002",
            )

        comments = (
            await db.execute(select(StageComment).where(StageComment.stage_id == stage_id))
        ).scalars().all()
        assert len(comments) == 1


@pytest.mark.asyncio
async def test_different_request_ids_identical_text_remain_distinct_comments(session_env):
    """Two independent user comments with the same text but different
    client_request_id values must remain two distinct StageComments."""
    _engine, Session = session_env
    async with Session() as db:
        customer, _contractor, project, stage = await _seed(db)

        first = await stage_svc.add_comment(
            db,
            stage_id=stage.id,
            user_id=customer.id,
            role=customer.role.value,
            text="Всё хорошо",
            project_id=project.id,
            client_request_id="offline-stage-comment-0003",
        )
        second = await stage_svc.add_comment(
            db,
            stage_id=stage.id,
            user_id=customer.id,
            role=customer.role.value,
            text="Всё хорошо",
            project_id=project.id,
            client_request_id="offline-stage-comment-0004",
        )

        assert first.id != second.id
        comments = (
            await db.execute(select(StageComment).where(StageComment.stage_id == stage.id))
        ).scalars().all()
        assert len(comments) == 2
