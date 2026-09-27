"""Issue #451: stage reaction reads/writes must be bound to the authorized project and stage.

Regression coverage for the IDOR where all three reaction routes authorized only the
URL project_id via require_project_dep(), then trusted attacker-controlled stage_id /
comment_id without proving Stage.project_id == project_id and StageComment.stage_id ==
stage_id.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import (
    CommentReaction,
    Project,
    Stage,
    StageComment,
    StageStatus,
    User,
    UserRole,
)


async def _seed(db, suffix: str):
    customer_a = User(id=f"cust-a-{suffix}", phone=f"+7900000{suffix}1", role=UserRole.customer)
    contractor_a = User(id=f"contr-a-{suffix}", phone=f"+7900000{suffix}2", role=UserRole.contractor)
    outsider = User(id=f"outsider-{suffix}", phone=f"+7900000{suffix}3", role=UserRole.contractor)

    project_a = Project(
        id=f"proj-a-{suffix}",
        name="Project A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor_a.id,
    )
    project_b = Project(
        id=f"proj-b-{suffix}",
        name="Project B",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=outsider.id,
    )
    stage_a = Stage(
        id=f"stage-a-{suffix}",
        project_id=project_a.id,
        name="Stage A",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
    )
    stage_b = Stage(
        id=f"stage-b-{suffix}",
        project_id=project_b.id,
        name="Stage B",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
    )
    comment_a = StageComment(
        id=f"comment-a-{suffix}",
        stage_id=stage_a.id,
        user_id=customer_a.id,
        author_role="customer",
        text="Comment on project A",
    )
    comment_b = StageComment(
        id=f"comment-b-{suffix}",
        stage_id=stage_b.id,
        user_id=outsider.id,
        author_role="contractor",
        text="Comment on project B",
    )
    db.add_all(
        [
            customer_a,
            contractor_a,
            outsider,
            project_a,
            project_b,
            stage_a,
            stage_b,
            comment_a,
            comment_b,
        ]
    )
    await db.commit()
    return {
        "contractor_a": contractor_a,
        "outsider": outsider,
        "project_a": project_a,
        "project_b": project_b,
        "stage_a": stage_a,
        "stage_b": stage_b,
        "comment_a": comment_a,
        "comment_b": comment_b,
    }


def _override(db, user):
    async def _db():
        yield db

    async def _user():
        return user

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user


@pytest.mark.asyncio
async def test_react_rejects_foreign_stage_comment_pair_and_leaves_data_untouched(db):
    """Actor authorized to Project A cannot write a reaction using Project A's URL
    paired with Project B's stage/comment ids; Project B reactions stay unchanged."""
    g = await _seed(db, "w451a")
    _override(db, g["contractor_a"])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(
                f"/api/v1/projects/{g['project_a'].id}/stages/{g['stage_b'].id}/comments/{g['comment_b'].id}/react",
                json={"reaction": "👍"},
            )
            assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.clear()

    rows = (
        await db.execute(
            select(CommentReaction).where(CommentReaction.comment_id == g["comment_b"].id)
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_react_rejects_comment_from_another_stage_in_same_project(db):
    """A comment that belongs to a different stage cannot be reacted to through a
    valid stage URL, even within the same project."""
    g = await _seed(db, "w451b")
    other_stage = Stage(
        id="stage-a2-w451b",
        project_id=g["project_a"].id,
        name="Stage A2",
        sort_order=1,
        status=StageStatus.planned,
        percent_complete=0,
    )
    db.add(other_stage)
    await db.commit()

    _override(db, g["contractor_a"])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(
                f"/api/v1/projects/{g['project_a'].id}/stages/{other_stage.id}/comments/{g['comment_a'].id}/react",
                json={"reaction": "👍"},
            )
            assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.clear()

    rows = (
        await db.execute(
            select(CommentReaction).where(CommentReaction.comment_id == g["comment_a"].id)
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_get_reacts_does_not_expose_foreign_comment(db):
    """GET reactions-by-comment must not leak Project B data through a Project A URL."""
    g = await _seed(db, "w451c")
    db.add(CommentReaction(id="react-b-w451c", comment_id=g["comment_b"].id, user_id=g["outsider"].id, reaction="🔥"))
    await db.commit()

    _override(db, g["contractor_a"])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.get(
                f"/api/v1/projects/{g['project_a'].id}/stages/{g['stage_b'].id}/comments/{g['comment_b'].id}/react"
            )
            assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_reaction_counts_does_not_expose_foreign_stage(db):
    """reaction-counts must not accept an authorized project_id paired with a
    foreign stage_id to expose that stage's reaction data."""
    g = await _seed(db, "w451d")
    db.add(CommentReaction(id="react-b2-w451d", comment_id=g["comment_b"].id, user_id=g["outsider"].id, reaction="🔥"))
    await db.commit()

    _override(db, g["contractor_a"])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.get(
                f"/api/v1/projects/{g['project_a'].id}/stages/{g['stage_b'].id}/reaction-counts"
            )
            assert r.status_code == 404, r.text
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_same_project_same_stage_react_and_read_still_works(db):
    """Positive path: authorized actor reacting/reading within their own project and
    stage keeps working exactly as before."""
    g = await _seed(db, "w451e")
    _override(db, g["contractor_a"])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(
                f"/api/v1/projects/{g['project_a'].id}/stages/{g['stage_a'].id}/comments/{g['comment_a'].id}/react",
                json={"reaction": "👍"},
            )
            assert r.status_code == 200, r.text
            assert {"user_id": g["contractor_a"].id, "reaction": "👍"} in r.json()["reactions"]

            r2 = await client.get(
                f"/api/v1/projects/{g['project_a'].id}/stages/{g['stage_a'].id}/comments/{g['comment_a'].id}/react"
            )
            assert r2.status_code == 200, r2.text
            assert {"user_id": g["contractor_a"].id, "reaction": "👍"} in r2.json()["reactions"]

            r3 = await client.get(
                f"/api/v1/projects/{g['project_a'].id}/stages/{g['stage_a'].id}/reaction-counts"
            )
            assert r3.status_code == 200, r3.text
            assert r3.json()[g["comment_a"].id]["counts"] == {"👍": 1}
    finally:
        app.dependency_overrides.clear()
