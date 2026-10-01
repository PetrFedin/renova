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


# --------------------------------------------------------------------------- lifecycle (QLT-004)
# Без миграций: статусы существующего ProjectIssue.
#   open --accept--> in_progress --fixed--> fixed --close--> closed
#   open|in_progress --reject--> rejected (комментарий обязателен)
#   closed|rejected|fixed --reopen (заказчик)--> open
# Ответ исполнителя дописывается в description (отдельного поля в модели нет),
# а также уходит в ленту активности и в уведомление второй стороне.
from fastapi import HTTPException  # noqa: E402

from app.models.entities import UserRole  # noqa: E402
from app.services import activity_service as activity_svc  # noqa: E402
from app.services import notification_service as notif_svc  # noqa: E402

WARRANTY_PREFIX = "[Гарантия]"
RESPONSE_DECISIONS = {"accept": "in_progress", "reject": "rejected", "fixed": "fixed"}
_DECISION_FROM = {
    "accept": {"open"},
    "reject": {"open", "in_progress"},
    "fixed": {"open", "in_progress"},
}
_DECISION_LABEL = {"accept": "принял в работу", "reject": "отклонил", "fixed": "отметил исправленным"}
_DESCRIPTION_LIMIT = 4000


def _claim_title(issue: ProjectIssue) -> str:
    title = issue.title or ""
    return title[len(WARRANTY_PREFIX):].strip() if title.startswith(WARRANTY_PREFIX) else title


async def _load_claim(db: AsyncSession, project_id: str, issue_id: str) -> ProjectIssue:
    issue = await db.get(ProjectIssue, issue_id)
    if issue is None or issue.project_id != project_id:
        raise HTTPException(404, "warranty_not_found")
    if not (issue.title or "").startswith(WARRANTY_PREFIX):
        raise HTTPException(400, "not_a_warranty_claim")
    return issue


def _is_customer(project: Project, actor) -> bool:
    return actor.role == UserRole.customer and actor.id == project.customer_id


def _state_error(issue: ProjectIssue, action: str) -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "warranty_claim_state_invalid",
            "message": f"Обращение в статусе «{issue.status}»: действие «{action}» недоступно.",
            "status": issue.status,
        },
    )


def _append_note(issue: ProjectIssue, header: str, comment: str | None) -> None:
    if not comment:
        return
    note = f"\n\n— {header} ({utc_now().strftime('%d.%m.%Y')}): {comment}"
    issue.description = ((issue.description or "") + note)[-_DESCRIPTION_LIMIT:]


async def _sync_warranty_document(db: AsyncSession, project_id: str, issue_id: str, *, archive: bool) -> None:
    docs = (
        await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.project_id == project_id,
                ProjectDocument.document_type == DocumentType.warranty.value,
                ProjectDocument.notes.contains(f"warranty_issue:{issue_id}"),
            )
        )
    ).scalars().all()
    for doc in docs:
        if archive and doc.status != DocumentStatus.archived.value:
            doc.status = DocumentStatus.archived.value
        elif not archive and doc.status == DocumentStatus.archived.value:
            doc.status = DocumentStatus.draft.value


async def _notify_other_side(
    db: AsyncSession,
    *,
    project: Project,
    actor_id: str,
    title: str,
    body: str,
) -> None:
    """Уведомить противоположную сторону. Ссылки — реальные маршруты: заказчику «Документы»,
    исполнителю «Контроль качества»."""
    if actor_id == project.customer_id:
        target, link, return_to = project.contractor_id, "/quality-control", "/(contractor)/(tabs)/"
    else:
        target, link, return_to = project.customer_id, "/documents", "/(customer)/(tabs)/"
    if target and target != actor_id:
        await notif_svc.notify(
            db,
            user_id=target,
            project_id=project.id,
            notification_type="issue",
            title=title,
            body=body,
            link_path=link,
            return_to=return_to,
        )


async def respond_to_claim(
    db: AsyncSession,
    *,
    project: Project,
    actor,
    issue_id: str,
    decision: str,
    comment: str | None,
) -> ProjectIssue:
    """Ответ исполнителя: принял / отклонил (с обязательным комментарием) / исправлено."""
    if decision not in RESPONSE_DECISIONS:
        raise HTTPException(422, "warranty_decision_invalid")
    if _is_customer(project, actor):
        raise HTTPException(403, detail={"code": "warranty_response_contractor_only", "message": "Отвечает исполнитель."})
    issue = await _load_claim(db, project.id, issue_id)
    target = RESPONSE_DECISIONS[decision]
    clean = " ".join((comment or "").split()) or None
    if decision == "reject" and not clean:
        raise HTTPException(422, detail={"code": "warranty_rejection_comment_required", "message": "Укажите причину отказа."})
    if issue.status == target:
        return issue  # идемпотентный повтор
    if issue.status not in _DECISION_FROM[decision]:
        raise _state_error(issue, _DECISION_LABEL[decision])
    issue.status = target
    issue.closed_at = None
    _append_note(issue, f"Ответ исполнителя: {_DECISION_LABEL[decision]}", clean)
    claim = _claim_title(issue)
    await activity_svc.log_event(
        db,
        project_id=project.id,
        user_id=actor.id,
        kind="WarrantyResponse",
        title=issue.title,
        body=f"{_DECISION_LABEL[decision]}" + (f": {clean}" if clean else ""),
        link_path="/quality-control",
    )
    await _notify_other_side(
        db,
        project=project,
        actor_id=actor.id,
        title=f"Гарантия: исполнитель {_DECISION_LABEL[decision]} — {claim}",
        body=clean or "Откройте обращение, чтобы проверить результат.",
    )
    await db.commit()
    await db.refresh(issue)
    return issue


async def close_claim(db: AsyncSession, *, project: Project, actor, issue_id: str) -> tuple[ProjectIssue, bool]:
    """Закрытие заказчиком. Повтор идемпотентен: closed_at не переписывается, повторного уведомления нет."""
    if not _is_customer(project, actor):
        raise HTTPException(403, "warranty_close_customer_only")
    issue = await _load_claim(db, project.id, issue_id)
    if issue.status == "closed":
        return issue, False
    issue.status = "closed"
    issue.closed_at = utc_now()
    await _sync_warranty_document(db, project.id, issue.id, archive=True)
    await activity_svc.log_event(
        db,
        project_id=project.id,
        user_id=actor.id,
        kind="WarrantyClosed",
        title=issue.title,
        link_path="/documents",
    )
    await _notify_other_side(
        db,
        project=project,
        actor_id=actor.id,
        title=f"Гарантийное обращение закрыто: {_claim_title(issue)}",
        body="Заказчик подтвердил, что вопрос решён.",
    )
    await db.commit()
    await db.refresh(issue)
    return issue, True


async def reopen_claim(
    db: AsyncSession,
    *,
    project: Project,
    actor,
    issue_id: str,
    comment: str | None,
) -> ProjectIssue:
    """Заказчик открывает обращение снова после closed / rejected / fixed."""
    if not _is_customer(project, actor):
        raise HTTPException(403, detail={"code": "warranty_reopen_customer_only", "message": "Открыть снова может заказчик."})
    issue = await _load_claim(db, project.id, issue_id)
    if issue.status == "open":
        return issue
    if issue.status not in {"closed", "rejected", "fixed"}:
        raise _state_error(issue, "открыть снова")
    clean = " ".join((comment or "").split()) or None
    issue.status = "open"
    issue.closed_at = None
    issue.due_at = utc_now() + timedelta(days=WARRANTY_SLA_DAYS)
    _append_note(issue, "Повторно открыто заказчиком", clean)
    await _sync_warranty_document(db, project.id, issue.id, archive=False)
    await activity_svc.log_event(
        db,
        project_id=project.id,
        user_id=actor.id,
        kind="WarrantyReopened",
        title=issue.title,
        body=clean,
        link_path="/documents",
    )
    await _notify_other_side(
        db,
        project=project,
        actor_id=actor.id,
        title=f"Гарантийное обращение открыто снова: {_claim_title(issue)}",
        body=clean or "Заказчик считает, что вопрос не решён.",
    )
    await db.commit()
    await db.refresh(issue)
    return issue
