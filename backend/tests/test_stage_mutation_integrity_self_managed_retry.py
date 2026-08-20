from __future__ import annotations

from datetime import date
import json

import pytest
from sqlalchemy import func, select

import app.models.outbox_runtime  # noqa: F401
from app.models.entities import Project, Room, Stage, StagePhoto, StageStatus, User, UserRole, WorkAcceptance
from app.services import stage_review_service


@pytest.mark.asyncio
async def test_competing_self_managed_review_submissions_collapse_to_one_acceptance(db):
    """Regression for the row-lock concurrency contract.

    Production PostgreSQL serializes competing submitters on the Stage row. The
    deterministic post-lock sequence is: first request commits review+acceptance,
    second request observes that committed state and returns a replay. Running the
    serialized outcome here avoids pretending SQLite implements FOR UPDATE while
    still protecting the invariant that concurrent retries cannot create two
    acceptances for one stage.
    """
    customer_id = "self-stage-race-customer"
    project_id = "self-stage-race-project"
    room_id = "self-stage-race-room"
    stage_id = "self-stage-race-stage"

    customer = User(
        id=customer_id,
        phone="+77018880001",
        role=UserRole.customer,
    )
    project = Project(
        id=project_id,
        name="Self-managed retry race",
        renovation_type="cosmetic",
        customer_id=customer_id,
        contractor_id=None,
        planned_start_date=date(2026, 8, 1),
        planned_end_date=date(2026, 9, 30),
    )
    room = Room(
        id=room_id,
        project_id=project_id,
        name="Комната",
        room_type="living",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=2,
    )
    stage = Stage(
        id=stage_id,
        project_id=project_id,
        name="Финиш",
        sort_order=0,
        status=StageStatus.active,
        percent_complete=100,
        payment_amount=50_000,
        checklist_json=json.dumps(
            [{"id": "done", "title": "Завершить", "done": True}],
            ensure_ascii=False,
        ),
        room_ids_json=json.dumps([room_id]),
    )
    photo = StagePhoto(
        id="self-stage-race-photo",
        stage_id=stage_id,
        user_id=customer_id,
        caption="После работ",
        image_url="https://example.com/race-result.jpg",
    )
    db.add_all([customer, project, room, stage, photo])
    await db.commit()

    project = await db.get(Project, project_id)
    customer = await db.get(User, customer_id)
    assert project is not None and customer is not None
    first, first_error = await stage_review_service.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=customer,
        comment="Готово",
    )
    assert first_error is None
    assert first is not None
    assert first.replayed is False
    acceptance_id = first.acceptance.id

    # This is the state the loser of a concurrent FOR UPDATE race must observe.
    project = await db.get(Project, project_id)
    customer = await db.get(User, customer_id)
    assert project is not None and customer is not None
    second, second_error = await stage_review_service.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=customer,
        comment="Повторная доставка того же действия",
    )
    assert second_error is None
    assert second is not None
    assert second.replayed is True
    assert second.acceptance.id == acceptance_id

    assert await db.scalar(
        select(func.count())
        .select_from(WorkAcceptance)
        .where(
            WorkAcceptance.project_id == project_id,
            WorkAcceptance.stage_id == stage_id,
        )
    ) == 1

    final_stage = await db.get(Stage, stage_id)
    assert final_stage is not None
    assert final_stage.status == StageStatus.review
    assert final_stage.contractor_ready is True
