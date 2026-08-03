"""Canonical, locked request/accept/return lifecycle for work acceptance."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    AcceptanceStatus,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.services import outbox_service as outbox
from app.services import stage_review_service

_PENDING = {
    AcceptanceStatus.requested.value,
    AcceptanceStatus.in_review.value,
}
_ACCEPTED = {
    AcceptanceStatus.accepted.value,
    AcceptanceStatus.accepted_with_remarks.value,
}


@dataclass(frozen=True)
class AcceptanceDecisionResult:
    acceptance: WorkAcceptance
    stage: Stage
    replayed: bool
    payment_id: str | None = None
    next_stage_id: str | None = None
    issue_id: str | None = None


def _require_customer(project: Project, actor: User) -> None:
    if actor.role != UserRole.customer or actor.id != project.customer_id:
        raise ValueError("acceptance_decision_customer_only")


async def _acceptance_stage_id(
    db: AsyncSession,
    *,
    project_id: str,
    acceptance_id: str,
) -> str | None:
    return (
        await db.execute(
            select(WorkAcceptance.stage_id).where(
                WorkAcceptance.id == acceptance_id,
                WorkAcceptance.project_id == project_id,
            )
        )
    ).scalar_one_or_none()


async def _locked_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> Stage | None:
    query = select(Stage).where(
        Stage.id == stage_id,
        Stage.project_id == project_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _latest_locked_acceptance(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> WorkAcceptance | None:
    query = (
        select(WorkAcceptance)
        .where(
            WorkAcceptance.project_id == project_id,
            WorkAcceptance.stage_id == stage_id,
        )
        .order_by(WorkAcceptance.created_at.desc(), WorkAcceptance.id.desc())
        .limit(1)
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _dispatch(db: AsyncSession, source: str) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source=source, limit=10)


async def request_acceptance(
    db: AsyncSession,
    *,
    project: Project,
    stage_id: str,
    actor: User,
    comment: str | None = None,
) -> tuple[AcceptanceDecisionResult | None, dict | None]:
    """Use the exact same completion and acceptance lifecycle as stage submit."""
    result, error = await stage_review_service.submit_for_review(
        db,
        project=project,
        stage_id=stage_id,
        actor=actor,
        comment=comment,
    )
    if result is None:
        return None, error
    return (
        AcceptanceDecisionResult(
            acceptance=result.acceptance,
            stage=result.stage,
            replayed=result.replayed,
        ),
        error,
    )


async def accept_work(
    db: AsyncSession,
    *,
    project: Project,
    acceptance_id: str,
    actor: User,
    comment: str | None = None,
    quality_score: float | None = None,
    create_issue: bool = False,
    checklist: list[str] | None = None,
    source_mode: str = "full",
    source: str = "app",
) -> AcceptanceDecisionResult | None:
    """Serialize one current acceptance and its complete financial/document cascade."""
    _require_customer(project, actor)
    stage_id = await _acceptance_stage_id(
        db,
        project_id=project.id,
        acceptance_id=acceptance_id,
    )
    if stage_id is None:
        await db.rollback()
        return None

    stage = await _locked_stage(
        db,
        project_id=project.id,
        stage_id=stage_id,
    )
    if stage is None:
        await db.rollback()
        return None
    row = await _latest_locked_acceptance(
        db,
        project_id=project.id,
        stage_id=stage.id,
    )
    if row is None:
        await db.rollback()
        return None
    if row.id != acceptance_id:
        await db.rollback()
        raise ValueError("acceptance_not_current")

    if row.status in _ACCEPTED:
        if stage.status != StageStatus.done:
            await db.rollback()
            raise ValueError("acceptance_state_inconsistent")
        await db.commit()
        return AcceptanceDecisionResult(row, stage, True)
    if row.status not in _PENDING:
        await db.rollback()
        raise ValueError("acceptance_already_decided")
    if stage.status != StageStatus.review:
        await db.rollback()
        raise ValueError(f"stage_accept_invalid_status:{stage.status.value}")

    from app.services.acceptance_policy import assert_accept_policy
    from app.services.accept_orchestrator import finalize_work_acceptance

    mode = (source_mode or "full").strip().lower()
    decision_source = (source or "app").strip().lower() or "app"
    try:
        assert_accept_policy(
            stage,
            checklist=checklist,
            source="inline" if mode == "inline" else "api",
        )
        finalized = await finalize_work_acceptance(
            db,
            project=project,
            stage=stage,
            row=row,
            accepted_by=actor.id,
            comment=comment,
            quality_score=quality_score,
            create_issue=create_issue,
            checklist=checklist,
        )
        await outbox.enqueue(
            db,
            aggregate_type="work_acceptance",
            aggregate_id=finalized.acceptance.id,
            event_type="acceptance.side_effects",
            payload={
                "project_id": project.id,
                "stage_id": finalized.stage.id,
                "accepted_by": actor.id,
                "comment": comment,
                "payment_id": finalized.payment.id if finalized.payment else None,
                "next_stage_id": finalized.next_stage.id if finalized.next_stage else None,
                "source": decision_source,
            },
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(finalized.acceptance)
    await db.refresh(finalized.stage)
    await _dispatch(db, f"work_acceptance.accept.{decision_source}")
    return AcceptanceDecisionResult(
        acceptance=finalized.acceptance,
        stage=finalized.stage,
        replayed=False,
        payment_id=finalized.payment.id if finalized.payment else None,
        next_stage_id=finalized.next_stage.id if finalized.next_stage else None,
    )


async def return_work(
    db: AsyncSession,
    *,
    project: Project,
    acceptance_id: str,
    actor: User,
    comment: str,
    quality_score: float | None = None,
    create_issue: bool = False,
) -> AcceptanceDecisionResult | None:
    """Bind return to the latest acceptance and reuse the canonical rework lifecycle."""
    _require_customer(project, actor)
    stage_id = await _acceptance_stage_id(
        db,
        project_id=project.id,
        acceptance_id=acceptance_id,
    )
    if stage_id is None:
        await db.rollback()
        return None

    result = await stage_review_service.reject_for_rework(
        db,
        project=project,
        stage_id=stage_id,
        actor=actor,
        reason=comment,
        expected_acceptance_id=acceptance_id,
        quality_score=quality_score,
        create_issue=create_issue,
    )
    if result is None:
        return None
    return AcceptanceDecisionResult(
        acceptance=result.acceptance,
        stage=result.stage,
        replayed=result.replayed,
        issue_id=result.issue_id,
    )
