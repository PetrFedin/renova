from __future__ import annotations

from datetime import date
import json

import pytest
from sqlalchemy import func, select

import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.api.v1 import stage_mutations, stages_ext
from app.models.entities import (
    DomainOutbox,
    Payment,
    Project,
    Room,
    Stage,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.services import accept_orchestrator
from app.services import outbox_service as outbox
from app.services import project_document_service
from app.services import stage_mutation_service as mutations
from app.services import stage_review_service
from app.services import work_acceptance_decision_service as decisions


async def seed_self_managed_project(db, suffix: str = "self"):
    customer = User(
        id=f"self-stage-customer-{suffix}",
        phone=f"+7701000{sum(map(ord, suffix)) % 10000:04d}",
        role=UserRole.customer,
    )
    project = Project(
        id=f"self-stage-project-{suffix}",
        name="Self-managed renovation",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=None,
        planned_start_date=date(2026, 8, 1),
        planned_end_date=date(2026, 10, 31),
    )
    room = Room(
        id=f"self-stage-room-{suffix}",
        project_id=project.id,
        name="Комната",
        room_type="living",
        length_m=4,
        width_m=3,
        height_m=2.7,
        openings_sq_m=2,
    )
    db.add_all([customer, project, room])
    await db.commit()
    return customer, project, room


@pytest.mark.asyncio
async def test_customer_only_stage_runs_end_to_end_without_self_payment_or_self_notification(
    db,
    monkeypatch,
):
    customer, project, room = await seed_self_managed_project(db, "e2e")
    customer_id = customer.id
    project_id = project.id
    room_id = room.id

    created = await mutations.create_stage(
        db,
        project_id=project_id,
        actor=customer,
        name="Самостоятельная отделка",
        planned_start=date(2026, 8, 10),
        planned_end=date(2026, 8, 20),
        room_ids=[room_id],
        work_type="painting",
        client_request_id="self-stage-create-e2e",
    )
    stage_id = created.stage.id
    assert created.replayed is False
    assert created.stage.status == StageStatus.planned

    project = await db.get(Project, project_id)
    customer = await db.get(User, customer_id)
    stage = await db.get(Stage, stage_id)
    assert project is not None and customer is not None and stage is not None
    planned_caps = await stages_ext.stage_detail_capabilities(
        db,
        project=project,
        stage=stage,
        actor=customer,
    )
    assert planned_caps == {
        "can_schedule": True,
        "can_start": True,
        "can_submit_for_review": False,
        "can_review": False,
        "payment_expected_on_accept": False,
    }

    # Customer-only scheduling is real, not a create-only exception.
    changed = await mutations.update_dates(
        db,
        project_id=project_id,
        stage_id=stage_id,
        actor=customer,
        planned_start=date(2026, 8, 11),
        planned_end=date(2026, 8, 21),
    )
    assert changed is not None
    assert changed.stage.planned_start == date(2026, 8, 11)
    changed = await mutations.update_work_type(
        db,
        project_id=project_id,
        stage_id=stage_id,
        actor=customer,
        work_type="finishing",
    )
    assert changed is not None
    assert changed.stage.work_type == "finishing"

    async def contract_gate_must_not_run(*_args, **_kwargs):
        raise AssertionError("self-managed stage must not require a contractor contract")

    monkeypatch.setattr(
        project_document_service,
        "project_contract_gate",
        contract_gate_must_not_run,
    )
    customer = await db.get(User, customer_id)
    assert customer is not None
    started, start_error = await mutations.start_stage(
        db,
        project_id=project_id,
        stage_id=stage_id,
        actor=customer,
    )
    assert start_error is None
    assert started is not None
    assert started.stage.status == StageStatus.active
    assert started.stage.actual_start is not None

    # Create/start/date changes are business events, but must not notify the actor
    # about their own action in a one-person project.
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_id == stage_id,
            DomainOutbox.event_type == outbox.NOTIFICATION_EVENT,
        )
    ) == 0

    project = await db.get(Project, project_id)
    customer = await db.get(User, customer_id)
    stage = await db.get(Stage, stage_id)
    assert project is not None and customer is not None and stage is not None
    active_caps = await stages_ext.stage_detail_capabilities(
        db,
        project=project,
        stage=stage,
        actor=customer,
    )
    assert active_caps["can_schedule"] is True
    assert active_caps["can_start"] is False
    assert active_caps["can_submit_for_review"] is True
    assert active_caps["payment_expected_on_accept"] is False

    stage.percent_complete = 100
    stage.payment_amount = 75_000
    stage.checklist_json = json.dumps(
        [{"id": "finish", "title": "Завершить работы", "done": True}],
        ensure_ascii=False,
    )
    db.add(
        StagePhoto(
            id="self-stage-result-photo",
            stage_id=stage_id,
            user_id=customer_id,
            caption="Фото результата",
            image_url="https://example.com/self-result.jpg",
        )
    )
    await db.commit()

    customer = await db.get(User, customer_id)
    assert customer is not None
    ready = await stage_mutations.mark_ready(
        project_id,
        stage_id,
        user=customer,
        db=db,
    )
    assert ready["status"] == StageStatus.review.value
    assert ready["acceptance_status"] == "requested"
    acceptance_id = str(ready["acceptance_id"])

    acceptance = await db.get(WorkAcceptance, acceptance_id)
    assert acceptance is not None
    assert acceptance.requested_by == customer_id
    assert acceptance.accepted_by is None
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_id == stage_id,
            DomainOutbox.event_type == outbox.NOTIFICATION_EVENT,
        )
    ) == 0

    project = await db.get(Project, project_id)
    customer = await db.get(User, customer_id)
    stage = await db.get(Stage, stage_id)
    assert project is not None and customer is not None and stage is not None
    review_caps = await stages_ext.stage_detail_capabilities(
        db,
        project=project,
        stage=stage,
        actor=customer,
    )
    assert review_caps["can_review"] is True
    assert review_caps["payment_expected_on_accept"] is False

    notified: list[str] = []

    async def capture_notify(_db, *, user_id: str, **_kwargs):
        notified.append(user_id)

    # Capture the canonical outbox side effects during accept_work. Do not replay
    # emit_acceptance_side_effects manually: duplicate dispatch would make the test
    # exercise a non-production path.
    monkeypatch.setattr(accept_orchestrator.notif, "notify", capture_notify)

    project = await db.get(Project, project_id)
    customer = await db.get(User, customer_id)
    assert project is not None and customer is not None
    accepted = await decisions.accept_work(
        db,
        project=project,
        acceptance_id=acceptance_id,
        actor=customer,
        comment="Проверено лично",
    )
    assert accepted is not None
    assert accepted.replayed is False
    assert accepted.payment_id is None

    final_stage = await db.get(Stage, stage_id)
    final_acceptance = await db.get(WorkAcceptance, acceptance_id)
    assert final_stage is not None and final_acceptance is not None
    assert final_stage.status == StageStatus.done
    assert final_acceptance.requested_by == customer_id
    assert final_acceptance.accepted_by == customer_id
    assert await db.scalar(
        select(func.count())
        .select_from(Payment)
        .where(Payment.project_id == project_id, Payment.stage_id == stage_id)
    ) == 0
    assert notified == []


@pytest.mark.asyncio
async def test_hybrid_customer_does_not_gain_stage_execution_by_self_managed_rule(db):
    customer, project, room = await seed_self_managed_project(db, "hybrid")
    customer_id = customer.id
    project_id = project.id
    room_id = room.id
    contractor = User(
        id="self-stage-hybrid-contractor",
        phone="+77019999999",
        role=UserRole.contractor,
    )
    contractor_id = contractor.id
    project.contractor_id = contractor_id
    stage = Stage(
        id="self-stage-hybrid-stage",
        project_id=project_id,
        name="Hybrid stage",
        status=StageStatus.planned,
        assignee_id=customer_id,
        sort_order=0,
        percent_complete=0,
        room_ids_json=json.dumps([room_id]),
    )
    stage_id = stage.id
    db.add_all([contractor, project, stage])
    await db.commit()

    customer = await db.get(User, customer_id)
    project = await db.get(Project, project_id)
    stage = await db.get(Stage, stage_id)
    assert customer is not None and project is not None and stage is not None
    hybrid_caps = await stages_ext.stage_detail_capabilities(
        db,
        project=project,
        stage=stage,
        actor=customer,
    )
    assert hybrid_caps == {
        "can_schedule": False,
        "can_start": False,
        "can_submit_for_review": False,
        "can_review": False,
        "payment_expected_on_accept": False,
    }

    with pytest.raises(ValueError, match="stage_schedule_actor_forbidden"):
        await mutations.create_stage(
            db,
            project_id=project_id,
            actor=customer,
            name="Customer must not widen hybrid ownership",
            room_ids=[room_id],
        )

    # create_stage rolls back on ACL failure, so refetch every ORM entity before
    # the next operation instead of touching expired instances.
    customer = await db.get(User, customer_id)
    stage = await db.get(Stage, stage_id)
    assert customer is not None and stage is not None
    with pytest.raises(ValueError, match="stage_execution_actor_forbidden"):
        await mutations.start_stage(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=customer,
        )

    # start_stage also rolls back on ACL failure; refetch again before mutation.
    current = await db.get(Stage, stage_id)
    assert current is not None
    current.status = StageStatus.active
    current.percent_complete = 100
    current.checklist_json = json.dumps(
        [{"id": "finish", "title": "Завершить", "done": True}]
    )
    db.add(
        StagePhoto(
            id="self-stage-hybrid-photo",
            stage_id=stage_id,
            user_id=customer_id,
            image_url="https://example.com/hybrid.jpg",
        )
    )
    await db.commit()

    customer = await db.get(User, customer_id)
    project = await db.get(Project, project_id)
    assert customer is not None and project is not None
    with pytest.raises(ValueError, match="stage_submit_actor_forbidden"):
        await stage_review_service.submit_for_review(
            db,
            project=project,
            stage_id=stage_id,
            actor=customer,
        )
