"""Read-only Action Responsibility projection for Renova Action OS.

This module does not mutate workflow state and does not grant authorization.
It projects existing project truth into "who acts now / what / what proves it /
who acts next" records. Domain mutation endpoints remain authoritative.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, ProjectIssue, Stage, User, WorkAcceptance
from app.services import project_capability_service as capability_svc
from app.services import technical_supervision_action_service as supervision_actions


_OPEN_EXECUTOR_STATES = {"open", "assigned", "in_progress"}
_REVIEW_STATES = {"fixed", "review"}
_PENDING_ACCEPTANCE_STATES = {"requested", "in_review"}


@dataclass(frozen=True)
class ResponsibilityEvidence:
    required: tuple[str, ...]
    present: tuple[str, ...]


@dataclass(frozen=True)
class ResponsibilityNext:
    capability: str
    persona: str
    user_id: str | None
    action: str


@dataclass(frozen=True)
class ResponsibilityItem:
    resource_type: str
    resource_id: str
    resource_title: str
    current_state: str
    required_capability: str
    responsible_persona: str
    responsible_user_id: str | None
    action: str
    due_at: str | None
    evidence: ResponsibilityEvidence
    completion_condition: str
    next: ResponsibilityNext | None

    def to_dict(self) -> dict:
        return asdict(self)


async def _persona_for_user(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str | None,
    fallback: str,
) -> str:
    if not user_id:
        return fallback
    user = await db.get(User, user_id)
    if user is None:
        return fallback
    context = await capability_svc.resolve_operational_context(db, user=user, project=project)
    return context.persona


async def _latest_acceptance(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
) -> WorkAcceptance | None:
    return await db.scalar(
        select(WorkAcceptance)
        .where(
            WorkAcceptance.project_id == project_id,
            WorkAcceptance.stage_id == stage_id,
        )
        .order_by(WorkAcceptance.created_at.desc(), WorkAcceptance.id.desc())
        .limit(1)
    )


async def _issue_executor(
    db: AsyncSession,
    *,
    project: Project,
    issue: ProjectIssue,
) -> tuple[str | None, str]:
    user_id = issue.assignee_id
    if not user_id and issue.stage_id:
        stage = await db.get(Stage, issue.stage_id)
        if stage is not None and stage.project_id == project.id:
            user_id = stage.assignee_id
    user_id = user_id or project.contractor_id
    persona = await _persona_for_user(
        db, project=project, user_id=user_id, fallback="lead"
    )
    return user_id, persona


def _issue_evidence(issue: ProjectIssue) -> ResponsibilityEvidence:
    present: list[str] = []
    if issue.photo_key:
        present.append("issue_photo")
    # v1 is intentionally truthful: current issue transitions do not yet enforce
    # a mandatory photo/act before "fixed", so required remains empty.
    return ResponsibilityEvidence(required=(), present=tuple(present))


async def build_action_responsibilities(
    db: AsyncSession,
    *,
    project: Project,
) -> list[ResponsibilityItem]:
    """Project existing issue/acceptance truth into a deterministic action queue."""
    issues = list(
        (
            await db.scalars(
                select(ProjectIssue)
                .where(
                    ProjectIssue.project_id == project.id,
                    ProjectIssue.status != "closed",
                )
                .order_by(ProjectIssue.due_at.asc(), ProjectIssue.created_at.asc(), ProjectIssue.id.asc())
            )
        ).all()
    )

    supervisor_id = await supervision_actions.active_supervisor_user_id(db, project.id)
    items: list[ResponsibilityItem] = []

    for issue in issues:
        if issue.status in _OPEN_EXECUTOR_STATES:
            responsible_user_id, persona = await _issue_executor(
                db, project=project, issue=issue
            )
            next_persona = "supervisor" if supervisor_id else "owner"
            next_user_id = supervisor_id or project.customer_id
            items.append(
                ResponsibilityItem(
                    resource_type="issue",
                    resource_id=issue.id,
                    resource_title=issue.title,
                    current_state=issue.status,
                    required_capability="field.write",
                    responsible_persona=persona,
                    responsible_user_id=responsible_user_id,
                    action="resolve_issue",
                    due_at=issue.due_at.isoformat() if issue.due_at else None,
                    evidence=_issue_evidence(issue),
                    completion_condition="issue.status == fixed",
                    next=ResponsibilityNext(
                        capability="quality.review",
                        persona=next_persona,
                        user_id=next_user_id,
                        action="verify_remediation",
                    ),
                )
            )
            continue

        if issue.status in _REVIEW_STATES:
            reviewer_id = supervisor_id or project.customer_id
            reviewer_persona = "supervisor" if supervisor_id else "owner"
            next_step: ResponsibilityNext | None = None
            if issue.stage_id:
                acceptance = await _latest_acceptance(
                    db, project_id=project.id, stage_id=issue.stage_id
                )
                if acceptance is not None and acceptance.status in _PENDING_ACCEPTANCE_STATES:
                    next_step = ResponsibilityNext(
                        capability="acceptance.decide",
                        persona="owner",
                        user_id=project.customer_id,
                        action="decide_work_acceptance",
                    )
            items.append(
                ResponsibilityItem(
                    resource_type="issue",
                    resource_id=issue.id,
                    resource_title=issue.title,
                    current_state=issue.status,
                    required_capability="quality.review",
                    responsible_persona=reviewer_persona,
                    responsible_user_id=reviewer_id,
                    action="verify_remediation",
                    due_at=issue.due_at.isoformat() if issue.due_at else None,
                    evidence=_issue_evidence(issue),
                    completion_condition="issue.status == closed",
                    next=next_step,
                )
            )

    return items
