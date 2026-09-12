"""#398 / #316: queued stage comments are keyed by explicit user intent."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Project, Stage, StageComment, StageStatus, User, UserRole
from app.services import stage_comment_intent as comment_svc
from app.services.client_write_idempotency import IdempotencyConflict


async def seed(db):
    user = User(
        id=str(uuid.uuid4()),
        phone=f"+795{uuid.uuid4().int % 100000000:08d}",
        role=UserRole.customer,
    )
    project = Project(
        id=str(uuid.uuid4()),
        name="Comment replay",
        renovation_type="cosmetic",
        customer_id=user.id,
    )
    stage = Stage(
        id=str(uuid.uuid4()),
        project_id=project.id,
        name="Stage",
        status=StageStatus.active,
    )
    db.add_all([user, project, stage])
    await db.commit()
    return user.id, project.id, stage.id


async def count(db, model, *where):
    return await db.scalar(select(func.count()).select_from(model).where(*where))


async def create(db, *, user_id, project_id, stage_id, request_id="stage-comment-loss-001", text="Комментарий"):
    return await comment_svc.create_comment(
        db,
        project_id=project_id,
        stage_id=stage_id,
        user_id=user_id,
        author_role="customer",
        client_request_id=request_id,
        text=text,
    )


@pytest.mark.asyncio
async def test_response_loss_replay_returns_original_comment(db):
    user_id, project_id, stage_id = await seed(db)
    first = await create(db, user_id=user_id, project_id=project_id, stage_id=stage_id)

    Session = async_sessionmaker(db.bind, expire_on_commit=False)
    async with Session() as fresh:
        second = await create(fresh, user_id=user_id, project_id=project_id, stage_id=stage_id)
        assert second.id == first.id
        assert await count(fresh, StageComment, StageComment.stage_id == stage_id) == 1
        assert await count(fresh, ClientWriteRequest, ClientWriteRequest.scope == comment_svc.SCOPE) == 1


@pytest.mark.asyncio
async def test_same_key_changed_text_conflicts_without_duplicate(db):
    user_id, project_id, stage_id = await seed(db)
    first = await create(db, user_id=user_id, project_id=project_id, stage_id=stage_id)
    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await create(db, user_id=user_id, project_id=project_id, stage_id=stage_id, text="Другое содержание")
    assert await count(db, StageComment, StageComment.stage_id == stage_id) == 1
    assert (await db.get(StageComment, first.id)).text == "Комментарий"


@pytest.mark.asyncio
async def test_equal_text_with_distinct_intent_ids_is_two_comments(db):
    user_id, project_id, stage_id = await seed(db)
    first = await create(
        db, user_id=user_id, project_id=project_id, stage_id=stage_id,
        request_id="stage-comment-first-001", text="Одинаково",
    )
    second = await create(
        db, user_id=user_id, project_id=project_id, stage_id=stage_id,
        request_id="stage-comment-second-001", text="Одинаково",
    )
    assert first.id != second.id
    assert await count(db, StageComment, StageComment.stage_id == stage_id) == 2
    assert await count(db, ClientWriteRequest, ClientWriteRequest.scope == comment_svc.SCOPE) == 2


@pytest.mark.asyncio
async def test_precommit_failure_rolls_back_comment_and_mapping(db, monkeypatch):
    user_id, project_id, stage_id = await seed(db)

    async def fail_commit(*args, **kwargs):
        await db.flush()
        raise RuntimeError("injected_precommit_failure")

    monkeypatch.setattr(comment_svc, "commit_client_write", fail_commit)
    with pytest.raises(RuntimeError, match="injected_precommit_failure"):
        await create(db, user_id=user_id, project_id=project_id, stage_id=stage_id)

    assert await count(db, StageComment, StageComment.stage_id == stage_id) == 0
    assert await count(db, ClientWriteRequest, ClientWriteRequest.scope == comment_svc.SCOPE) == 0
