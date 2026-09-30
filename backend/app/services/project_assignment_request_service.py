"""Contractor self-claims (requests) and customer-side lead release.

Decision of the product owner: a contractor who says "I want to lead this
project" is never assigned by that statement. The claim is stored as a pending
ProjectAssignmentRequest; only the project's customer can accept it (which
performs the ordinary lead assignment incl. the free-plan limit) or decline it.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Payment, PaymentStatus, Project, Stage, StageStatus, User, UserRole
from app.models.project_assignment_requests import ProjectAssignmentRequest
from app.models.project_documents import DocumentSignature, ProjectDocument
from app.services import notification_service
from app.services import project_assignment_service as assignment
from app.services import project_participant_service as participants

CUSTOMER_LINK = "/(customer)/(tabs)/profile?focus=contractor"
CONTRACTOR_LINK = "/(contractor)/(tabs)/profile"


@dataclass
class RequestResult:
    status: str
    request: ProjectAssignmentRequest | None = None
    created: bool = False
    project: Project | None = None
    current_contractor_id: str | None = None
    blockers: list[dict] | None = None


async def _lock_project(db: AsyncSession, project_id: str) -> Project | None:
    return await db.scalar(
        select(Project).where(Project.id == project_id)
        .with_for_update().execution_options(populate_existing=True)
    )


async def _customer_owner(db: AsyncSession, project: Project, actor_id: str) -> bool:
    actor = await db.get(User, actor_id, populate_existing=True)
    return bool(
        actor is not None and actor.deleted_at is None
        and actor.role == UserRole.customer and actor.id == project.customer_id
    )


async def _notify(db, *, user_id, project_id, title, body, link) -> None:
    try:
        await notification_service.notify(
            db, user_id=user_id, project_id=project_id, notification_type="approval",
            title=title, body=body, link_path=link,
        )
    except Exception:  # noqa: BLE001 — a notification failure must not undo the decision
        await db.rollback()


async def request_assignment(
    db: AsyncSession, *, project_id: str, contractor_id: str, message: str | None = None,
) -> RequestResult:
    try:
        project = await _lock_project(db, project_id)
        if project is None:
            await db.rollback()
            return RequestResult("not_found")
        if project.trashed_at is not None:
            await db.rollback()
            return RequestResult("project_trashed")
        actor = await db.get(User, contractor_id, populate_existing=True)
        if actor is None or actor.deleted_at is not None or actor.role != UserRole.contractor:
            await db.rollback()
            return RequestResult("forbidden")
        if project.contractor_id == contractor_id:
            await db.rollback()
            return RequestResult("already_lead", current_contractor_id=contractor_id)
        if project.contractor_id:
            current = project.contractor_id
            await db.rollback()
            return RequestResult("already_assigned", current_contractor_id=current)
        existing = await db.scalar(
            select(ProjectAssignmentRequest).where(
                ProjectAssignmentRequest.project_id == project_id,
                ProjectAssignmentRequest.contractor_id == contractor_id,
                ProjectAssignmentRequest.status == "pending",
            ).execution_options(populate_existing=True)
        )
        if existing is not None:
            await db.rollback()
            await db.refresh(existing)
            return RequestResult("pending", request=existing, created=False)
        req = ProjectAssignmentRequest(
            project_id=project_id, contractor_id=contractor_id, status="pending",
            message=(message or "").strip()[:1000] or None,
        )
        db.add(req)
        await db.commit()
        customer_id, name = project.customer_id, project.name
        who = actor.full_name or actor.phone
    except BaseException:
        await db.rollback()
        raise
    await _notify(
        db, user_id=customer_id, project_id=project_id,
        title="Исполнитель предлагает вести проект",
        body=f"{who} хочет вести объект «{name}». Подтвердите или отклоните заявку.",
        link=CUSTOMER_LINK,
    )
    return RequestResult("pending", request=req, created=True)


async def list_requests(
    db: AsyncSession, *, project_id: str, user: User,
) -> list[ProjectAssignmentRequest] | None:
    project = await db.get(Project, project_id)
    if project is None:
        return None
    q = select(ProjectAssignmentRequest).where(ProjectAssignmentRequest.project_id == project_id)
    if user.role == UserRole.customer and project.customer_id == user.id:
        q = q.where(ProjectAssignmentRequest.status == "pending")
    elif user.role == UserRole.contractor:
        q = q.where(ProjectAssignmentRequest.contractor_id == user.id)
    else:
        return None
    return list((await db.scalars(q.order_by(ProjectAssignmentRequest.created_at.desc()))).all())


async def resolve_request(
    db: AsyncSession, *, project_id: str, request_id: str, actor_id: str, accept: bool,
) -> RequestResult:
    losers: list[str] = []
    try:
        project = await _lock_project(db, project_id)
        if project is None:
            await db.rollback()
            return RequestResult("not_found")
        if project.trashed_at is not None:
            await db.rollback()
            return RequestResult("project_trashed")
        if not await _customer_owner(db, project, actor_id):
            await db.rollback()
            return RequestResult("forbidden")
        req = await db.scalar(
            select(ProjectAssignmentRequest).where(
                ProjectAssignmentRequest.id == request_id,
                ProjectAssignmentRequest.project_id == project_id,
            ).with_for_update().execution_options(populate_existing=True)
        )
        if req is None:
            await db.rollback()
            return RequestResult("request_not_found")
        want = "accepted" if accept else "declined"
        if req.status != "pending":
            status = req.status
            await db.rollback()
            await db.refresh(req)
            if status == want:
                replay_project = await assignment._loaded_project(db, project_id) if accept else None
                return RequestResult(want, request=req, project=replay_project)
            return RequestResult("request_not_pending", request=req)
        contractor_id, name = req.contractor_id, project.name
        now = utc_now()
        if accept:
            error = await assignment.assign_locked(
                db, project=project, contractor_id=contractor_id, actor_id=actor_id,
            )
            if error is not None:
                current = project.contractor_id
                await db.rollback()
                if error == "subscription_required":
                    await _notify(
                        db, user_id=contractor_id, project_id=project_id,
                        title="Нужен Pro, чтобы вести объект",
                        body=f"Заказчик готов подтвердить вас на объекте «{name}», но лимит бесплатных объектов исчерпан. Оформите Pro.",
                        link=CONTRACTOR_LINK,
                    )
                return RequestResult(error, current_contractor_id=current)
            req.status, req.resolved_at, req.resolved_by = "accepted", now, actor_id
            others = list((await db.scalars(
                select(ProjectAssignmentRequest).where(
                    ProjectAssignmentRequest.project_id == project_id,
                    ProjectAssignmentRequest.status == "pending",
                    ProjectAssignmentRequest.id != req.id,
                ).with_for_update()
            )).all())
            for other in others:
                other.status, other.resolved_at, other.resolved_by = "superseded", now, actor_id
                losers.append(other.contractor_id)
        else:
            req.status, req.resolved_at, req.resolved_by = "declined", now, actor_id
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    if accept:
        await _notify(
            db, user_id=contractor_id, project_id=project_id,
            title="Заказчик подтвердил вас исполнителем",
            body=f"Вы ведёте объект «{name}».", link=CONTRACTOR_LINK,
        )
        for uid in losers:
            await _notify(
                db, user_id=uid, project_id=project_id,
                title="Заявка закрыта",
                body=f"На объекте «{name}» заказчик выбрал другого исполнителя.", link=CONTRACTOR_LINK,
            )
        loaded = await assignment._loaded_project(db, project_id)
        return RequestResult("accepted", request=req, project=loaded, current_contractor_id=contractor_id)
    await _notify(
        db, user_id=contractor_id, project_id=project_id,
        title="Заявка отклонена",
        body=f"Заказчик отклонил вашу заявку на объект «{name}».", link=CONTRACTOR_LINK,
    )
    return RequestResult("declined", request=req)


async def release_contractor(
    db: AsyncSession, *, project_id: str, actor_id: str,
) -> RequestResult:
    """Customer detaches the lead. Free only before work/signatures exist.

    Blocked (never destructive) when a stage left ``planned``, a payment was
    confirmed or a document carries a live signature. When allowed, only the link
    changes: estimate_locked_at/lock proposal are reset so the fixed estimate is
    not silently inherited by the next contractor; draft documents stay.
    """
    try:
        project = await _lock_project(db, project_id)
        if project is None:
            await db.rollback()
            return RequestResult("not_found")
        if not await _customer_owner(db, project, actor_id):
            await db.rollback()
            return RequestResult("forbidden")
        if project.trashed_at is not None:
            await db.rollback()
            return RequestResult("project_trashed")
        if not project.contractor_id:
            await db.rollback()
            return RequestResult("no_contractor")
        started = int(await db.scalar(
            select(func.count()).select_from(Stage).where(
                Stage.project_id == project_id, Stage.status != StageStatus.planned,
            )
        ) or 0)
        paid = int(await db.scalar(
            select(func.count()).select_from(Payment).where(
                Payment.project_id == project_id, Payment.status == PaymentStatus.confirmed,
            )
        ) or 0)
        signed = int(await db.scalar(
            select(func.count()).select_from(DocumentSignature)
            .join(ProjectDocument, ProjectDocument.id == DocumentSignature.document_id)
            .where(
                ProjectDocument.project_id == project_id,
                ProjectDocument.status != "deleted",
                DocumentSignature.status == "signed",
                DocumentSignature.revoked_at.is_(None),
            )
        ) or 0)
        blockers = []
        if started:
            blockers.append({
                "code": "contractor_work_started", "count": started,
                "message": f"Начатых или принятых этапов: {started}. Пока работы идут, исполнителя сменить нельзя — завершите или согласуйте закрытие объекта с исполнителем.",
            })
        if paid:
            blockers.append({
                "code": "contractor_has_confirmed_payments", "count": paid,
                "message": f"Подтверждённых платежей: {paid}. Сначала урегулируйте оплаты (возврат или отмена) в разделе «Бюджет».",
            })
        if signed:
            blockers.append({
                "code": "contractor_has_signed_documents", "count": signed,
                "message": f"Подписанных документов: {signed}. Сначала отзовите подписи (расторгните договор) в разделе «Документы».",
            })
        if blockers:
            current = project.contractor_id
            await db.rollback()
            return RequestResult("blocked", blockers=blockers, current_contractor_id=current)
        project.estimate_locked_at = None
        project.estimate_lock_proposed_at = None
        project.estimate_lock_proposed_by = None
        former = await participants.release_current_lead_in_transaction(
            db, project=project, actor_id=actor_id, reason="customer_released_lead",
        )
        name = project.name
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    if former:
        await _notify(
            db, user_id=former, project_id=project_id,
            title="Заказчик снял вас с объекта",
            body=f"Вы больше не ведёте объект «{name}».", link=CONTRACTOR_LINK,
        )
    loaded = await assignment._loaded_project(db, project_id)
    return RequestResult("released", project=loaded, current_contractor_id=None)


async def find_open_project_by_code(db: AsyncSession, code: str) -> str | None:
    """Resolve the 8-char object code shown to the customer to a project id.

    Only unassigned, non-trashed projects match, and only a unique match counts;
    the result merely lets the contractor raise a request the customer must
    confirm, so a guessed code grants no access.
    """
    clean = (code or "").strip().lower()
    if len(clean) != 8 or any(ch not in "0123456789abcdef" for ch in clean):
        return None
    ids = list((await db.scalars(
        select(Project.id).where(
            Project.id.like(f"{clean}%"),
            Project.contractor_id.is_(None),
            Project.trashed_at.is_(None),
        ).limit(2)
    )).all())
    return ids[0] if len(ids) == 1 else None


async def my_requests(db: AsyncSession, *, contractor_id: str) -> list[tuple[ProjectAssignmentRequest, str]]:
    rows = (await db.execute(
        select(ProjectAssignmentRequest, Project.name)
        .join(Project, Project.id == ProjectAssignmentRequest.project_id)
        .where(
            ProjectAssignmentRequest.contractor_id == contractor_id,
            ProjectAssignmentRequest.status.in_(("pending", "declined")),
        )
        .order_by(ProjectAssignmentRequest.created_at.desc()).limit(50)
    )).all()
    return [(r, n) for r, n in rows]
