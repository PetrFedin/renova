from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.stage_reactions import ReactIn, get_reacts, react, reaction_counts
from app.models.entities import (
    CommentReaction,
    Project,
    Stage,
    StageComment,
    StageStatus,
    User,
    UserRole,
)


async def _seed_scope(db):
    customer_a = User(id="reaction-customer-a", phone="+79000002101", role=UserRole.customer)
    contractor_a = User(id="reaction-contractor-a", phone="+79000002102", role=UserRole.contractor)
    customer_b = User(id="reaction-customer-b", phone="+79000002103", role=UserRole.customer)
    contractor_b = User(id="reaction-contractor-b", phone="+79000002104", role=UserRole.contractor)

    project_a = Project(
        id="reaction-project-a",
        name="Reaction Project A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor_a.id,
    )
    project_b = Project(
        id="reaction-project-b",
        name="Reaction Project B",
        renovation_type="cosmetic",
        customer_id=customer_b.id,
        contractor_id=contractor_b.id,
    )

    stage_a = Stage(
        id="reaction-stage-a",
        project_id=project_a.id,
        name="Stage A",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 9, 1),
        planned_end=date(2026, 9, 2),
    )
    stage_a2 = Stage(
        id="reaction-stage-a2",
        project_id=project_a.id,
        name="Stage A2",
        sort_order=1,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 9, 3),
        planned_end=date(2026, 9, 4),
    )
    stage_b = Stage(
        id="reaction-stage-b",
        project_id=project_b.id,
        name="Stage B",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        planned_start=date(2026, 10, 1),
        planned_end=date(2026, 10, 2),
    )

    comment_a = StageComment(
        id="reaction-comment-a",
        stage_id=stage_a.id,
        user_id=contractor_a.id,
        author_role="contractor",
        text="Project A comment",
    )
    comment_a2 = StageComment(
        id="reaction-comment-a2",
        stage_id=stage_a2.id,
        user_id=customer_a.id,
        author_role="customer",
        text="Project A second-stage comment",
    )
    comment_b = StageComment(
        id="reaction-comment-b",
        stage_id=stage_b.id,
        user_id=customer_b.id,
        author_role="customer",
        text="Project B comment",
    )
    reaction_b = CommentReaction(
        id="reaction-b-existing",
        comment_id=comment_b.id,
        user_id=customer_b.id,
        reaction="existing",
    )

    db.add_all(
        [
            customer_a,
            contractor_a,
            customer_b,
            contractor_b,
            project_a,
            project_b,
            stage_a,
            stage_a2,
            stage_b,
            comment_a,
            comment_a2,
            comment_b,
            reaction_b,
        ]
    )
    await db.commit()
    return {
        "actor": contractor_a,
        "project_a": project_a,
        "stage_a": stage_a,
        "stage_a2": stage_a2,
        "stage_b": stage_b,
        "comment_a": comment_a,
        "comment_a2": comment_a2,
        "comment_b": comment_b,
    }


@pytest.mark.asyncio
async def test_reaction_write_cannot_cross_authorized_project_boundary(db):
    seeded = await _seed_scope(db)
    project_a_id = seeded["project_a"].id
    stage_b_id = seeded["stage_b"].id
    comment_b_id = seeded["comment_b"].id

    with pytest.raises(HTTPException) as error:
        await react(
            project_a_id,
            stage_b_id,
            comment_b_id,
            ReactIn(reaction="foreign-write"),
            user=seeded["actor"],
            db=db,
            _=seeded["project_a"],
        )
    assert error.value.status_code == 404

    await db.rollback()
    db.expire_all()
    persisted = (
        await db.execute(
            select(CommentReaction).where(CommentReaction.comment_id == comment_b_id)
        )
    ).scalars().all()
    assert [(item.user_id, item.reaction) for item in persisted] == [
        ("reaction-customer-b", "existing")
    ]


@pytest.mark.asyncio
async def test_reaction_reads_cannot_cross_authorized_project_boundary(db):
    seeded = await _seed_scope(db)

    with pytest.raises(HTTPException) as comment_error:
        await get_reacts(
            seeded["project_a"].id,
            seeded["stage_b"].id,
            seeded["comment_b"].id,
            user=seeded["actor"],
            db=db,
            _=seeded["project_a"],
        )
    assert comment_error.value.status_code == 404

    with pytest.raises(HTTPException) as stage_error:
        await reaction_counts(
            seeded["project_a"].id,
            seeded["stage_b"].id,
            user=seeded["actor"],
            db=db,
            _=seeded["project_a"],
        )
    assert stage_error.value.status_code == 404


@pytest.mark.asyncio
async def test_reaction_comment_must_belong_to_stage_in_same_project(db):
    seeded = await _seed_scope(db)

    with pytest.raises(HTTPException) as write_error:
        await react(
            seeded["project_a"].id,
            seeded["stage_a"].id,
            seeded["comment_a2"].id,
            ReactIn(reaction="wrong-stage"),
            user=seeded["actor"],
            db=db,
            _=seeded["project_a"],
        )
    assert write_error.value.status_code == 404

    with pytest.raises(HTTPException) as read_error:
        await get_reacts(
            seeded["project_a"].id,
            seeded["stage_a"].id,
            seeded["comment_a2"].id,
            user=seeded["actor"],
            db=db,
            _=seeded["project_a"],
        )
    assert read_error.value.status_code == 404


@pytest.mark.asyncio
async def test_reaction_same_project_stage_comment_chain_still_works(db):
    seeded = await _seed_scope(db)
    project_id = seeded["project_a"].id
    stage_id = seeded["stage_a"].id
    comment_id = seeded["comment_a"].id

    write = await react(
        project_id,
        stage_id,
        comment_id,
        ReactIn(reaction="like"),
        user=seeded["actor"],
        db=db,
        _=seeded["project_a"],
    )
    assert write == {
        "reactions": [{"user_id": seeded["actor"].id, "reaction": "like"}]
    }

    read = await get_reacts(
        project_id,
        stage_id,
        comment_id,
        user=seeded["actor"],
        db=db,
        _=seeded["project_a"],
    )
    assert read == write

    counts = await reaction_counts(
        project_id,
        stage_id,
        user=seeded["actor"],
        db=db,
        _=seeded["project_a"],
    )
    assert counts[comment_id]["counts"] == {"like": 1}
    assert counts[comment_id]["users"] == [
        {"user_id": seeded["actor"].id, "reaction": "like"}
    ]
