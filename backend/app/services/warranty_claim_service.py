"""Создание гарантийных обращений с идемпотентностью и fail-safe audit.

Scope ключа: (user_id, project_id, idempotency_key).
Полное description в audit не пишем — только усечённый title / hash.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Project, ProjectIssue, User, WarrantyClaimIdempotency


def normalize_warranty_payload(
    *,
    title: str,
    description: str | None,
    category: str | None = None,
    related_issue_id: str | None = None,
    work_order_id: str | None = None,
    acceptance_id: str | None = None,
) -> dict[str, Any]:
    return {
        "title": (title or "").strip(),
        "description": (description or "").strip() or None,
        "category": (category or "").strip() or None,
        "related_issue_id": related_issue_id or None,
        "work_order_id": work_order_id or None,
        "acceptance_id": acceptance_id or None,
    }


def payload_hash(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _truncate_title(title: str, n: int = 80) -> str:
    t = (title or "").strip()
    return t if len(t) <= n else t[: n - 1] + "…"


async def count_similar_open_claims(
    db: AsyncSession,
    *,
    project_id: str,
    category: str | None = None,
    related_issue_id: str | None = None,
) -> int:
    """Мягкий бизнес-дубль: открытые [Гарантия] на том же проекте."""
    items = (
        await db.execute(
            select(ProjectIssue).where(
                ProjectIssue.project_id == project_id,
                ProjectIssue.status != "closed",
            )
        )
    ).scalars().all()
    open_w = [i for i in items if (i.title or "").startswith("[Гарантия]")]
    if related_issue_id:
        tag = f"related_issue:{related_issue_id}"
        open_w = [i for i in open_w if tag in (i.description or "")]
    if category:
        open_w = [i for i in open_w if category.lower() in (i.title or "").lower()]
    return len(open_w)


async def _audit_activity(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    kind: str,
    title: str,
    link_path: str,
) -> None:
    from app.services import activity_service as act

    await act.log_event(
        db,
        project_id=project_id,
        user_id=user_id,
        kind=kind,
        title=_truncate_title(title),
        body=None,
        link_path=link_path,
    )


async def create_warranty_claim_idempotent(
    db: AsyncSession,
    *,
    project: Project,
    user: User,
    title: str,
    description: str | None,
    idempotency_key: str | None,
    category: str | None = None,
    related_issue_id: str | None = None,
    work_order_id: str | None = None,
    acceptance_id: str | None = None,
) -> dict[str, Any]:
    """Транзакционное создание + unique scope. Replay / conflict по payload_hash."""
    from datetime import timedelta

    from app.models.project_documents import DocumentStatus, DocumentType
    from app.services import notification_service as notif
    from app.services import project_document_service as docs_svc

    project_id = project.id
    payload = normalize_warranty_payload(
        title=title,
        description=description,
        category=category,
        related_issue_id=related_issue_id,
        work_order_id=work_order_id,
        acceptance_id=acceptance_id,
    )
    phash = payload_hash(payload)
    key = (idempotency_key or "").strip()[:128] or None

    if key:
        existing = (
            await db.execute(
                select(WarrantyClaimIdempotency).where(
                    WarrantyClaimIdempotency.user_id == user.id,
                    WarrantyClaimIdempotency.project_id == project_id,
                    WarrantyClaimIdempotency.idempotency_key == key,
                )
            )
        ).scalar_one_or_none()
        if existing:
            if existing.payload_hash != phash:
                await _audit_activity(
                    db,
                    project_id=project_id,
                    user_id=user.id,
                    kind="warranty_claim_conflict",
                    title=f"Conflict key={key[:12]}…",
                    link_path="/documents",
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "warranty_claim_idempotency_conflict",
                        "message": "Тот же Idempotency-Key уже использован с другим содержимым обращения.",
                    },
                )
            try:
                cached = json.loads(existing.response_json or "{}")
            except json.JSONDecodeError:
                cached = {
                    "ok": True,
                    "issue_id": existing.issue_id,
                    "document_id": existing.document_id,
                }
            cached["idempotent_replay"] = True
            await _audit_activity(
                db,
                project_id=project_id,
                user_id=user.id,
                kind="warranty_claim_idempotent_replay",
                title=f"Replay {_truncate_title(payload['title'] or 'warranty')}",
                link_path=cached.get("qc_path") or "/quality-control",
            )
            return cached

    similar_open = await count_similar_open_claims(
        db,
        project_id=project_id,
        category=category,
        related_issue_id=related_issue_id,
    )

    post_closeout = bool(getattr(project, "is_archived", False))
    desc_parts = []
    if payload["description"]:
        desc_parts.append(payload["description"])
    if related_issue_id:
        desc_parts.append(f"related_issue:{related_issue_id}")
    if work_order_id:
        desc_parts.append(f"work_order:{work_order_id}")
    if acceptance_id:
        desc_parts.append(f"acceptance:{acceptance_id}")
    if category:
        desc_parts.append(f"category:{category}")

    issue = ProjectIssue(
        project_id=project_id,
        title=f"[Гарантия] {payload['title']}"[:255],
        description="\n".join(desc_parts) if desc_parts else None,
        severity="high",
        status="open",
        due_at=utc_now() + timedelta(days=14),
    )
    db.add(issue)
    await db.flush()

    try:
        draft = await docs_svc.create_document(
            db,
            project_id=project_id,
            created_by=user.id,
            title=f"Гарантия: {payload['title']}"[:200],
            document_type=DocumentType.warranty.value,
            notes=f"warranty_issue:{issue.id}",
        )
        draft.status = DocumentStatus.draft.value
        await db.flush()
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail={"code": "warranty_create_failed", "message": "Не удалось создать гарантийное обращение"})

    response = {
        "ok": True,
        "issue_id": issue.id,
        "document_id": draft.id,
        "qc_path": f"/quality-control?issueId={issue.id}",
        "due_at": issue.due_at.isoformat() if issue.due_at else None,
        "post_closeout": post_closeout,
        "sla_days": 14,
        "idempotent_replay": False,
        "similar_open_count": similar_open,
        "duplicate_hint": (
            "Уже есть открытое гарантийное обращение по этому проекту. "
            "Создаём ещё одно — при необходимости закройте старое."
            if similar_open > 0
            else None
        ),
    }

    if key:
        row = WarrantyClaimIdempotency(
            user_id=user.id,
            project_id=project_id,
            idempotency_key=key,
            payload_hash=phash,
            issue_id=issue.id,
            document_id=draft.id,
            response_json=json.dumps(
                {
                    "ok": True,
                    "issue_id": issue.id,
                    "document_id": draft.id,
                    "qc_path": response["qc_path"],
                    "due_at": response["due_at"],
                    "post_closeout": post_closeout,
                    "sla_days": 14,
                },
                ensure_ascii=False,
            ),
        )
        db.add(row)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            existing = (
                await db.execute(
                    select(WarrantyClaimIdempotency).where(
                        WarrantyClaimIdempotency.user_id == user.id,
                        WarrantyClaimIdempotency.project_id == project_id,
                        WarrantyClaimIdempotency.idempotency_key == key,
                    )
                )
            ).scalar_one_or_none()
            if not existing:
                raise HTTPException(500, "warranty_idempotency_race")
            if existing.payload_hash != phash:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "warranty_claim_idempotency_conflict",
                        "message": "Тот же Idempotency-Key уже использован с другим содержимым обращения.",
                    },
                )
            try:
                cached = json.loads(existing.response_json or "{}")
            except json.JSONDecodeError:
                cached = {"ok": True, "issue_id": existing.issue_id, "document_id": existing.document_id}
            cached["idempotent_replay"] = True
            return cached

    other = project.contractor_id if user.id == project.customer_id else project.customer_id
    if other:
        other_is_contractor = other == project.contractor_id
        await notif.notify(
            db,
            user_id=other,
            project_id=project_id,
            notification_type="issue",
            title=issue.title,
            body="Новое гарантийное обращение",
            link_path="/quality-control" if other_is_contractor else "/documents",
            return_to="/(contractor)/(tabs)/home" if other_is_contractor else "/(customer)/(tabs)/home",
        )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if not key:
            raise
        existing = (
            await db.execute(
                select(WarrantyClaimIdempotency).where(
                    WarrantyClaimIdempotency.user_id == user.id,
                    WarrantyClaimIdempotency.project_id == project_id,
                    WarrantyClaimIdempotency.idempotency_key == key,
                )
            )
        ).scalar_one_or_none()
        if existing and existing.payload_hash == phash:
            cached = json.loads(existing.response_json or "{}")
            cached["idempotent_replay"] = True
            return cached
        raise HTTPException(
            status_code=409,
            detail={
                "code": "warranty_claim_idempotency_conflict",
                "message": "Конфликт идемпотентности при создании гарантии.",
            },
        )

    creator_link = "/quality-control" if user.role.value == "contractor" else "/documents"
    await _audit_activity(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="warranty_claim_created",
        title=issue.title,
        link_path=creator_link,
    )
    return response
