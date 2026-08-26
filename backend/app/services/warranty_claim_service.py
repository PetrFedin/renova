"""Atomic, idempotent warranty-claim creation on the shared client-write ledger."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Project, ProjectIssue
from app.models.project_documents import DocumentStatus, DocumentType, ProjectDocument
from app.services import outbox_inline_dispatch
from app.services import project_document_service as docs_svc
from app.services.client_write_idempotency import commit_client_write, replay_entity_id
from app.services.client_write_side_effects import clear_request_side_effect_context

WARRANTY_CLAIM_CREATE_SCOPE = "warranty_claim.create"
WARRANTY_SLA_DAYS = 14


class WarrantyClaimTargetMissing(RuntimeError):
    """The durable idempotency row points to a claim that cannot be reconstructed."""


@dataclass(frozen=True)
class WarrantyClaimMutation:
    issue_id: str
    document_id: str
    due_at: str | None
    post_closeout: bool
    created: bool

    def response_dict(self) -> dict[str, object]:
        return {
            "ok": True,
            "issue_id": self.issue_id,
            "document_id": self.document_id,
            "qc_path": f"/quality-control?issueId={self.issue_id}",
            "due_at": self.due_at,
            "post_closeout": self.post_closeout,
            "sla_days": WARRANTY_SLA_DAYS,
            "idempotent_replay": not self.created,
        }


def canonical_warranty_payload(*, title: str, description: str | None) -> dict[str, object]:
    """Return exactly the business fields whose reuse under one request ID is valid."""
    return {
        "title": title,
        "description": description,
    }


async def _load_document_for_issue(
    db: AsyncSession,
    *,
    project_id: str,
    issue_id: str,
) -> ProjectDocument | None:
    return (
        await db.execute(
            select(ProjectDocument)
            .where(
                ProjectDocument.project_id == project_id,
                ProjectDocument.document_type == DocumentType.warranty.value,
                ProjectDocument.notes.contains(f"warranty_issue:{issue_id}"),
            )
            .order_by(ProjectDocument.created_at.asc(), ProjectDocument.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def load_warranty_claim_mutation(
    db: AsyncSession,
    *,
    project: Project,
    issue_id: str,
    created: bool,
) -> WarrantyClaimMutation:
    issue = await db.get(ProjectIssue, issue_id)
    if issue is None or issue.project_id != project.id:
        raise WarrantyClaimTargetMissing("warranty_claim_idempotency_target_missing")

    document = await _load_document_for_issue(
        db,
        project_id=project.id,
        issue_id=issue.id,
    )
    if document is None:
        raise WarrantyClaimTargetMissing("warranty_claim_document_missing")

    return WarrantyClaimMutation(
        issue_id=issue.id,
        document_id=document.id,
        due_at=issue.due_at.isoformat() if issue.due_at else None,
        post_closeout=bool(getattr(project, "is_archived", False)),
        created=created,
    )


async def create_or_replay_warranty_claim(
    db: AsyncSession,
    *,
    project: Project,
    user_id: str,
    title: str,
    description: str | None,
    client_request_id: str | None,
) -> WarrantyClaimMutation:
    """Create issue + document + ledger + side-effect outbox in one transaction.

    The shared ``ClientWriteRequest`` uniqueness constraint is the cross-replica
    race arbiter. Losing concurrent transactions are rolled back by
    ``commit_client_write`` and then reconstruct the winning canonical claim.
    """
    payload = canonical_warranty_payload(title=title, description=description)

    try:
        replay_id = await replay_entity_id(
            db,
            scope=WARRANTY_CLAIM_CREATE_SCOPE,
            project_id=project.id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
        )
        if replay_id:
            return await load_warranty_claim_mutation(
                db,
                project=project,
                issue_id=replay_id,
                created=False,
            )

        issue = ProjectIssue(
            project_id=project.id,
            title=f"[Гарантия] {title}"[:255],
            description=description,
            severity="high",
            status="open",
            due_at=utc_now() + timedelta(days=WARRANTY_SLA_DAYS),
        )
        db.add(issue)
        await db.flush()

        document = await docs_svc.create_document(
            db,
            project_id=project.id,
            created_by=user_id,
            title=f"Гарантия: {title}"[:200],
            document_type=DocumentType.warranty.value,
            notes=f"warranty_issue:{issue.id}",
        )
        document.status = DocumentStatus.draft.value
        await db.flush()

        created, canonical_issue_id = await commit_client_write(
            db,
            scope=WARRANTY_CLAIM_CREATE_SCOPE,
            project_id=project.id,
            user_id=user_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=issue.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise

    # This flow dispatches directly from the durable outbox rather than through
    # the request-local compatibility context. Never let that context leak into
    # a later mutation handled by the same asyncio task.
    clear_request_side_effect_context()

    if created:
        await outbox_inline_dispatch.dispatch_best_effort(
            db,
            source="warranty_claim.create",
            limit=4,
        )

    return await load_warranty_claim_mutation(
        db,
        project=project,
        issue_id=canonical_issue_id,
        created=created,
    )
