from __future__ import annotations

from datetime import date, timedelta
import json

import pytest
from sqlalchemy import func, select

import app.models.project_documents  # noqa: F401
from app.models.entities import (
    AcceptanceStatus,
    DomainOutbox,
    Payment,
    Project,
    Stage,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.models.project_documents import ProjectDocument
from app.services import work_acceptance_decision_service as decisions


@pytest.mark.asyncio
async def test_accept_rejects_an_older_pending_acceptance(db):
    customer = User(
        id="stale-accept-customer",
        phone="+74990000211",
        role=UserRole.customer,
    )
    contractor = User(
        id="stale-accept-contractor",
        phone="+74990000212",
        role=UserRole.contractor,
    )
    project = Project(
        id="stale-accept-project",
        name="Stale acceptance guard",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id="stale-accept-stage",
        project_id=project.id,
        name="Финишная отделка",
        sort_order=0,
        status=StageStatus.active,
        percent_complete=100,
        assignee_id=contractor.id,
        actual_start=date(2026, 8, 1),
        checklist_json=json.dumps(
            [{"id": "finish", "title": "Завершить работы", "done": True}],
            ensure_ascii=False,
        ),
    )
    photo = StagePhoto(
        id="stale-accept-photo",
        stage_id=stage.id,
        user_id=contractor.id,
        caption="Фото результата",
        image_url="https://example.com/result.jpg",
    )
    db.add_all([customer, contractor, project, stage, photo])
    await db.commit()

    requested, error = await decisions.request_acceptance(
        db,
        project=project,
        stage_id=stage.id,
        actor=contractor,
        comment="Первый запрос",
    )
    assert error is None
    assert requested is not None
    stale_id = requested.acceptance.id
    project_id = project.id
    stage_id = stage.id
    customer_id = customer.id

    current = WorkAcceptance(
        id="stale-accept-current",
        project_id=project_id,
        stage_id=stage_id,
        requested_by=contractor.id,
        requested_at=requested.acceptance.requested_at + timedelta(seconds=1),
        created_at=requested.acceptance.created_at + timedelta(seconds=1),
        status=AcceptanceStatus.requested.value,
        checklist_json=requested.acceptance.checklist_json,
        comment="Актуальный запрос",
    )
    db.add(current)
    await db.commit()
    current_id = current.id

    current_project = await db.get(Project, project_id)
    current_customer = await db.get(User, customer_id)
    assert current_project is not None
    assert current_customer is not None

    with pytest.raises(ValueError, match="acceptance_not_current"):
        await decisions.accept_work(
            db,
            project=current_project,
            acceptance_id=stale_id,
            actor=current_customer,
            comment="Устаревшее решение",
        )

    assert await db.scalar(
        select(Stage.status).where(Stage.id == stage_id)
    ) == StageStatus.review
    assert await db.scalar(
        select(WorkAcceptance.status).where(WorkAcceptance.id == stale_id)
    ) == AcceptanceStatus.requested.value
    assert await db.scalar(
        select(WorkAcceptance.status).where(WorkAcceptance.id == current_id)
    ) == AcceptanceStatus.requested.value
    assert await db.scalar(
        select(func.count()).select_from(Payment).where(Payment.stage_id == stage_id)
    ) == 0
    assert await db.scalar(
        select(func.count())
        .select_from(ProjectDocument)
        .where(ProjectDocument.work_acceptance_id == stale_id)
    ) == 0
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(
            DomainOutbox.aggregate_id == stale_id,
            DomainOutbox.event_type == "acceptance.side_effects",
        )
    ) == 0
