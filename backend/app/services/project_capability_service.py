"""Project-scoped operational persona and capability projection.

This module does not replace authorization. It derives UX-facing responsibility
from the existing canonical ACL sources: project ownership, lead contractor,
team membership, scoped project participants, technical supervision and viewers.
Mutation routes must continue to enforce their domain authorization server-side.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User, UserRole
from app.services import project_participant_service as participant_svc
from app.services import team_service
from app.services import technical_supervision_service as supervision


OPERATIONAL_PERSONAS = frozenset(
    {"owner", "lead", "foreman", "member", "participant", "supervisor", "guest"}
)

OWNER_CAPABILITIES = frozenset(
    {
        "project.read",
        "project.manage",
        "participants.manage",
        "commercial.review",
        "schedule.review",
        "acceptance.decide",
        "payment.pay",
        "documents.manage",
        "communication.write",
    }
)
LEAD_CAPABILITIES = frozenset(
    {
        "project.read",
        "field.write",
        "schedule.manage",
        "commercial.manage",
        "documents.manage",
        "team.manage",
        "acceptance.submit",
        "billing.issue",
        "escalation.raise",
        "communication.write",
    }
)
FOREMAN_CAPABILITIES = frozenset(
    {
        "project.read",
        "field.write",
        "schedule.manage",
        "billing.issue",
        "escalation.raise",
        "communication.write",
    }
)
MEMBER_CAPABILITIES = frozenset(
    {"project.read", "field.write", "communication.write"}
)
PARTICIPANT_BASE_CAPABILITIES = frozenset(
    {"project.read_scoped", "field.write_scoped", "communication.write_scoped"}
)
SUPERVISOR_CAPABILITY_MAP = {
    "project_read": "project.read",
    "communication": "communication.write",
    "quality_issue_write": "quality.issue",
    "quality_review": "quality.review",
    "schedule_review": "schedule.review",
}
GUEST_CAPABILITIES = frozenset({"project.read"})


@dataclass(frozen=True)
class OperationalContext:
    persona: str
    capabilities: tuple[str, ...]
    read_only: bool

    def __post_init__(self) -> None:
        if self.persona not in OPERATIONAL_PERSONAS:
            raise ValueError(f"unknown_operational_persona:{self.persona}")


def _context(persona: str, capabilities: frozenset[str] | set[str], *, read_only: bool) -> OperationalContext:
    return OperationalContext(persona, tuple(sorted(capabilities)), read_only)


async def resolve_operational_context(
    db: AsyncSession, *, user: User, project: Project
) -> OperationalContext:
    """Derive one UX persona from canonical project authority, fail-closed."""
    if project.customer_id == user.id:
        return _context("owner", OWNER_CAPABILITIES, read_only=False)

    if project.contractor_id == user.id:
        return _context("lead", LEAD_CAPABILITIES, read_only=False)

    if user.role == UserRole.contractor:
        membership = await team_service.project_team_membership(
            db, user_id=user.id, contractor_id=project.contractor_id
        )
        if membership is not None:
            if membership.role == "foreman":
                return _context("foreman", FOREMAN_CAPABILITIES, read_only=False)
            if membership.role == "member":
                return _context("member", MEMBER_CAPABILITIES, read_only=False)
            # Existing team viewer is intentionally projected as guest: readable,
            # no mutation capability.
            if membership.role == "viewer":
                return _context("guest", GUEST_CAPABILITIES, read_only=True)

    if await supervision.is_active_supervisor(db, project_id=project.id, user_id=user.id):
        capabilities = {
            SUPERVISOR_CAPABILITY_MAP[name]
            for name in supervision.SUPERVISOR_CAPABILITIES
            if name in SUPERVISOR_CAPABILITY_MAP
        }
        return _context("supervisor", capabilities, read_only=True)

    if user.role == UserRole.contractor:
        participant = await participant_svc.active_participant(
            db, project_id=project.id, user_id=user.id
        )
        if participant is not None and participant.participant_role != "lead_contractor":
            capabilities = set(PARTICIPANT_BASE_CAPABILITIES)
            if participant.can_manage_schedule:
                capabilities.add("schedule.manage_scoped")
            if participant.can_manage_commercial:
                capabilities.add("commercial.manage_scoped")
            if participant.can_manage_documents:
                capabilities.add("documents.manage_scoped")
            return _context("participant", capabilities, read_only=True)

    if await team_service.is_project_guest(db, user.id, project.id):
        return _context("guest", GUEST_CAPABILITIES, read_only=True)

    # This resolver is only called for already-readable project projections.
    # Unknown access remains least-privilege and must never widen UX actions.
    return _context("guest", frozenset(), read_only=True)
