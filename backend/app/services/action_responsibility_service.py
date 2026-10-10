"""Read-only Action Responsibility projection for Renova Action OS.

This module does not mutate workflow state and does not grant authorization.
It projects existing project truth into "who acts now / what / what proves it /
who acts next" records. Domain mutation endpoints remain authoritative.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Payment, PaymentStatus, Project, ProjectIssue, Stage, User, WorkAcceptance
from app.services import project_capability_service as capability_svc
from app.services import project_participant_service as participant_svc
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
class EscalationSignal:
    resource_type: str
    resource_id: str
    resource_title: str
    reason: str
    due_at: str
    responsible_persona: str
    responsible_user_id: str | None
    target_persona: str
    target_user_id: str
    source_action: str

    def to_dict(self) -> dict:
        return asdict(self)

@dataclass(frozen=True)
class SlaRoute:
    resource_type: str
    resource_id: str
    resource_title: str
    due_at: str
    state: str
    responsible_persona: str
    responsible_user_id: str
    routed_persona: str
    routed_user_id: str
    route_reason: str
    source_action: str

    def to_dict(self) -> dict:
        return asdict(self)


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
    user_id = user_id or project.contractor_id or project.customer_id
    fallback = "lead" if project.contractor_id else "owner"
    persona = await _persona_for_user(
        db, project=project, user_id=user_id, fallback=fallback
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
    actor: User,
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

    finance_visible = actor.id in {project.customer_id, project.contractor_id}
    payments = (
        list(
            (
                await db.scalars(
                    select(Payment)
                    .where(
                        Payment.project_id == project.id,
                        Payment.status.in_(
                            {
                                PaymentStatus.pending,
                                PaymentStatus.paid_unverified,
                            }
                        ),
                    )
                    .order_by(Payment.created_at.asc(), Payment.id.asc())
                )
            ).all()
        )
        if finance_visible
        else []
    )

    acceptances = list(
        (
            await db.scalars(
                select(WorkAcceptance)
                .where(
                    WorkAcceptance.project_id == project.id,
                    WorkAcceptance.status.in_(_PENDING_ACCEPTANCE_STATES),
                )
                .order_by(WorkAcceptance.requested_at.asc(), WorkAcceptance.created_at.asc(), WorkAcceptance.id.asc())
            )
        ).all()
    )

    if actor.id not in {project.customer_id, project.contractor_id}:
        participant = await participant_svc.active_participant(
            db, project_id=project.id, user_id=actor.id
        )
        if participant is not None and participant.participant_role != "lead_contractor":
            visible_stage_ids, visible_room_ids = await participant_svc.participant_visible_scope(
                db, project=project, user_id=actor.id
            )
            issues = [
                issue for issue in issues
                if (issue.stage_id and issue.stage_id in visible_stage_ids)
                or (issue.room_id and issue.room_id in visible_room_ids)
            ]
            acceptances = [
                acceptance for acceptance in acceptances
                if acceptance.stage_id in visible_stage_ids
            ]

    supervisor_id = await supervision_actions.active_supervisor_user_id(db, project.id)
    items: list[ResponsibilityItem] = []

    for issue in issues:
        if issue.status in _OPEN_EXECUTOR_STATES:
            responsible_user_id, persona = await _issue_executor(
                db, project=project, issue=issue
            )
            next_persona = "supervisor" if supervisor_id else "owner"
            next_user_id = supervisor_id or project.customer_id
            required_capability = (
                "field.write_scoped" if persona == "participant" else "field.write"
            )
            items.append(
                ResponsibilityItem(
                    resource_type="issue",
                    resource_id=issue.id,
                    resource_title=issue.title,
                    current_state=issue.status,
                    required_capability=required_capability,
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
                stage = await db.get(Stage, issue.stage_id)
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
                elif stage is not None and stage.project_id == project.id and stage.needs_rework:
                    executor_id, executor_persona = await _issue_executor(
                        db, project=project, issue=issue
                    )
                    submit_capability = (
                        "acceptance.submit_scoped"
                        if executor_persona == "participant"
                        else "acceptance.submit"
                    )
                    next_step = ResponsibilityNext(
                        capability=submit_capability,
                        persona=executor_persona,
                        user_id=executor_id,
                        action="resubmit_stage",
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

    for acceptance in acceptances:
        stage = await db.get(Stage, acceptance.stage_id)
        stage_title = stage.name if stage is not None and stage.project_id == project.id else "Этап"
        items.append(
            ResponsibilityItem(
                resource_type="acceptance",
                resource_id=acceptance.id,
                resource_title=f"Приёмка: {stage_title}",
                current_state=acceptance.status,
                required_capability="acceptance.decide",
                responsible_persona="owner",
                responsible_user_id=project.customer_id,
                action="decide_work_acceptance",
                due_at=None,
                evidence=ResponsibilityEvidence(required=(), present=()),
                completion_condition="acceptance.status in {accepted, accepted_with_remarks, returned}",
                next=None,
            )
        )

    for payment in payments:
        if payment.status == PaymentStatus.pending:
            items.append(
                ResponsibilityItem(
                    resource_type="payment",
                    resource_id=payment.id,
                    resource_title=payment.title,
                    current_state=payment.status.value,
                    required_capability="payment.pay",
                    responsible_persona="owner",
                    responsible_user_id=project.customer_id,
                    action="pay_invoice",
                    due_at=None,
                    evidence=ResponsibilityEvidence(required=(), present=()),
                    completion_condition="payment.status != pending",
                    next=None,
                )
            )
            continue

        if payment.status == PaymentStatus.paid_unverified and project.contractor_id:
            items.append(
                ResponsibilityItem(
                    resource_type="payment",
                    resource_id=payment.id,
                    resource_title=payment.title,
                    current_state=payment.status.value,
                    required_capability="payment.receive.confirm",
                    responsible_persona="lead",
                    responsible_user_id=project.contractor_id,
                    action="confirm_payment_received",
                    due_at=None,
                    evidence=ResponsibilityEvidence(required=(), present=("transfer_marked",)),
                    completion_condition="payment.status in {confirmed, pending}",
                    next=None,
                )
            )

    return items


QUEUE_BUCKETS = (
    "mine_now",
    "waiting_other",
    "overdue",
    "needs_evidence",
    "waiting_review",
    "waiting_owner_decision",
)

QUEUE_PRIORITY = (
    "overdue",
    "needs_evidence",
    "waiting_review",
    "waiting_owner_decision",
    "mine_now",
    "waiting_other",
)
_QUEUE_PRIORITY_INDEX = {bucket: index for index, bucket in enumerate(QUEUE_PRIORITY)}


def _item_is_overdue(item: ResponsibilityItem, now: datetime) -> bool:
    if not item.due_at:
        return False
    try:
        due = datetime.fromisoformat(item.due_at)
    except ValueError:
        return False
    if due.tzinfo is not None:
        due = due.replace(tzinfo=None)
    if now.tzinfo is not None:
        now = now.replace(tzinfo=None)
    return due < now


def _item_missing_evidence(item: ResponsibilityItem) -> bool:
    required = set(item.evidence.required)
    return bool(required and not required.issubset(set(item.evidence.present)))


def responsibility_bucket(
    item: ResponsibilityItem,
    *,
    actor_id: str,
    now: datetime | None = None,
) -> str:
    """Assign exactly one human queue bucket with stable operational priority."""
    current = now or utc_now()
    if _item_is_overdue(item, current):
        return "overdue"
    if _item_missing_evidence(item):
        return "needs_evidence"
    if item.action == "verify_remediation":
        return "waiting_review"
    if item.action == "decide_work_acceptance":
        return "waiting_owner_decision"
    if item.responsible_user_id == actor_id:
        return "mine_now"
    return "waiting_other"


def group_action_responsibilities(
    items: list[ResponsibilityItem],
    *,
    actor_id: str,
) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {bucket: [] for bucket in QUEUE_BUCKETS}
    now = utc_now()
    for item in items:
        grouped[responsibility_bucket(item, actor_id=actor_id, now=now)].append(item.to_dict())
    return grouped


def parallel_responsibility_summary(
    items: list[ResponsibilityItem],
    *,
    actor_id: str,
) -> dict:
    """Group concurrent human obligations by concrete actor without creating new authority."""
    now = utc_now()
    lane_items: dict[tuple[str, str], list[tuple[str, ResponsibilityItem]]] = {}

    for item in items:
        actor_key = item.responsible_user_id or f"persona:{item.responsible_persona}"
        key = (actor_key, item.responsible_persona)
        bucket = responsibility_bucket(item, actor_id=actor_id, now=now)
        lane_items.setdefault(key, []).append((bucket, item))

    lanes: list[dict] = []
    for (actor_key, persona), entries in lane_items.items():
        bucket_counts = {bucket: 0 for bucket in QUEUE_BUCKETS}
        for bucket, _item in entries:
            bucket_counts[bucket] += 1

        ordered_entries = sorted(
            entries,
            key=lambda entry: (
                _QUEUE_PRIORITY_INDEX[entry[0]],
                entry[1].due_at or "9999-12-31T23:59:59",
                entry[1].resource_type,
                entry[1].resource_id,
            ),
        )
        top_bucket, top_item = ordered_entries[0]
        responsible_user_id = top_item.responsible_user_id

        lanes.append(
            {
                "actor_key": actor_key,
                "persona": persona,
                "responsible_user_id": responsible_user_id,
                "is_current_actor": responsible_user_id == actor_id,
                "count": len(entries),
                "bucket_counts": bucket_counts,
                "top_bucket": top_bucket,
                "top_item": top_item.to_dict(),
            }
        )

    lanes.sort(
        key=lambda lane: (
            _QUEUE_PRIORITY_INDEX[lane["top_bucket"]],
            0 if lane["is_current_actor"] else 1,
            lane["persona"],
            lane["actor_key"],
        )
    )

    return {
        "active_actor_count": len(lanes),
        "active_responsibility_count": len(items),
        "lanes": lanes,
    }


def escalation_signals(
    items: list[ResponsibilityItem],
    *,
    owner_user_id: str,
    now: datetime | None = None,
) -> list[EscalationSignal]:
    """Project overdue responsibilities into non-mutating escalation signals.

    This read model does not reassign work, notify users or create SLA state.
    Owner-owned overdue work stays in the overdue queue instead of escalating to
    the same person.
    """
    current = now or utc_now()
    signals: list[EscalationSignal] = []

    for item in items:
        if not _item_is_overdue(item, current):
            continue
        if not item.due_at or item.responsible_user_id == owner_user_id:
            continue

        target_persona = "owner"
        target_user_id = owner_user_id
        if (
            item.responsible_persona in {"lead", "foreman", "member", "participant"}
            and item.next is not None
            and item.next.persona == "supervisor"
            and item.next.user_id
        ):
            target_persona = "supervisor"
            target_user_id = item.next.user_id

        signals.append(
            EscalationSignal(
                resource_type=item.resource_type,
                resource_id=item.resource_id,
                resource_title=item.resource_title,
                reason="overdue",
                due_at=item.due_at,
                responsible_persona=item.responsible_persona,
                responsible_user_id=item.responsible_user_id,
                target_persona=target_persona,
                target_user_id=target_user_id,
                source_action=item.action,
            )
        )

    signals.sort(
        key=lambda signal: (
            signal.due_at,
            signal.target_persona,
            signal.resource_type,
            signal.resource_id,
        )
    )
    return signals


def sla_routing_summary(
    items: list[ResponsibilityItem],
    *,
    escalations: list[EscalationSignal],
    now: datetime | None = None,
) -> dict:
    """Route canonical responsibility deadlines without creating SLA authority.

    Future deadlines remain with the current responsible actor. Breached
    deadlines follow an already-derived escalation target when one exists.
    Owner-owned breaches remain with the owner because escalation_signals()
    intentionally avoids self-escalation.
    """
    current = now or utc_now()
    escalation_by_resource = {
        (signal.resource_type, signal.resource_id): signal
        for signal in escalations
    }
    routes: list[SlaRoute] = []

    for item in items:
        if not item.due_at or not item.responsible_user_id:
            continue

        breached = _item_is_overdue(item, current)
        signal = escalation_by_resource.get((item.resource_type, item.resource_id))
        if breached and signal is not None:
            routed_persona = signal.target_persona
            routed_user_id = signal.target_user_id
            route_reason = "escalation"
        else:
            routed_persona = item.responsible_persona
            routed_user_id = item.responsible_user_id
            route_reason = "responsibility"

        routes.append(
            SlaRoute(
                resource_type=item.resource_type,
                resource_id=item.resource_id,
                resource_title=item.resource_title,
                due_at=item.due_at,
                state="breached" if breached else "active",
                responsible_persona=item.responsible_persona,
                responsible_user_id=item.responsible_user_id,
                routed_persona=routed_persona,
                routed_user_id=routed_user_id,
                route_reason=route_reason,
                source_action=item.action,
            )
        )

    routes.sort(
        key=lambda route: (
            0 if route.state == "breached" else 1,
            route.due_at,
            route.routed_persona,
            route.resource_type,
            route.resource_id,
        )
    )
    return {
        "count": len(routes),
        "breached_count": sum(1 for route in routes if route.state == "breached"),
        "active_count": sum(1 for route in routes if route.state == "active"),
        "routes": [route.to_dict() for route in routes],
    }
