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
    pass

@dataclass(frozen=True)
class WarrantyClaimMutation:
    issue_id: str
    document_id: str
    due_at: str | None
    post_closeout: bool
    created: bool
    def response_dict(self) -> dict[str, object]:
        return {"ok": True, "issue_id": self.issue_id, "document_id": self.document_id, "qc_path": f"/quality-control?issueId={self.issue_id}", "due_at": self.due_at, "post_closeout": self.post_closeout, "sla_days": WARRANTY_SLA_DAYS, "idempotent_replay": not self.created}

def canonical_warranty_payload(*, title: str, description: str | None) -> dict[str, object]:
    return {"title": title, "description": description}

async def _load_document_for_issue(db: AsyncSession, *, project_id: str, issue_id: str) -> ProjectDocument | None:
    return (await db.execute(select(ProjectDocument).where(ProjectDocument.project_id == project_id, ProjectDocument.document_type == DocumentType.warranty.value, ProjectDocument.notes.contains(f"warranty_issue:{issue_id}")).order_by(ProjectDocument.created_at.asc(), ProjectDocument.id.asc()).limit(1))).scalar_one_or_none()

async def load_warranty_claim_mutation(db: AsyncSession, *, project_id: str, post_closeout: bool, issue_id: str, created: bool) -> WarrantyClaimMutation:
    issue = await db.get(ProjectIssue, issue_id)
    if issue is None or issue.project_id != project_id:
        raise WarrantyClaimTargetMissing("warranty_claim_idempotency_target_missing")
    document = await _load_document_for_issue(db, project_id=project_id, issue_id=issue.id)
    if document is None:
        raise WarrantyClaimTargetMissing("warranty_claim_document_missing")
    return WarrantyClaimMutation(issue_id=issue.id, document_id=document.id, due_at=issue.due_at.isoformat() if issue.due_at else None, post_closeout=post_closeout, created=created)

async def create_or_replay_warranty_claim(db: AsyncSession, *, project: Project, user_id: str, title: str, description: str | None, client_request_id: str) -> WarrantyClaimMutation:
    project_id = str(project.id)
    post_closeout = bool(project.is_archived)
    payload = canonical_warranty_payload(title=title, description=description)
    try:
        replay_id = await replay_entity_id(db, scope=WARRANTY_CLAIM_CREATE_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload)
        if replay_id:
            return await load_warranty_claim_mutation(db, project_id=project_id, post_closeout=post_closeout, issue_id=replay_id, created=False)
        issue = ProjectIssue(project_id=project_id, title=f"[Гарантия] {title}"[:255], description=description, severity="high", status="open", due_at=utc_now() + timedelta(days=WARRANTY_SLA_DAYS))
        db.add(issue)
        await db.flush()
        issue_id = str(issue.id)
        document = await docs_svc.create_document(db, project_id=project_id, created_by=user_id, title=f"Гарантия: {title}"[:200], document_type=DocumentType.warranty.value, notes=f"warranty_issue:{issue_id}")
        document.status = DocumentStatus.draft.value
        await db.flush()
        created, canonical_issue_id = await commit_client_write(db, scope=WARRANTY_CLAIM_CREATE_SCOPE, project_id=project_id, user_id=user_id, request_id=client_request_id, payload=payload, entity_id=issue_id)
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise
    clear_request_side_effect_context()
    if created:
        await outbox_inline_dispatch.dispatch_best_effort(db, source=WARRANTY_CLAIM_CREATE_SCOPE, limit=4)
    return await load_warranty_claim_mutation(db, project_id=project_id, post_closeout=post_closeout, issue_id=canonical_issue_id, created=created)
