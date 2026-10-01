"""Projects API — CRUD, dashboard, смета, этапы."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.models.entities import PaymentStatus
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectDetail, ProjectOut, EstimateLineOut, StageOut, RoomOut
from app.services import project_service as svc
from app.services import stage_status_service as stage_status_svc
from app.services import project_profile_service as profile_svc
from app.services.project_role_policy import require_project_owner
from app.services.stage_service import parse_room_ids
from app.services import room_service as room_svc
from app.services import project_document_service as docs_svc
from app.services import dashboard_integrity_service as dashboard_svc
from app.services import project_viewer_service as viewer_svc
from app.services import technical_supervision_service as supervision

router = APIRouter(prefix="/projects", tags=["projects"])


def _filter_stages_for_user(p, user: User):
    """Исполнитель видит только назначенные работы (или все, если assignee не задан — legacy проект)."""
    stages = sorted(p.stages or [], key=lambda x: x.sort_order)
    if user.role != UserRole.contractor:
        return stages
    return [
        s for s in stages
        if getattr(s, "assignee_id", None) == user.id
        or (getattr(s, "assignee_id", None) is None and p.contractor_id == user.id)
    ]


async def visible_stages_for_user(db, p, user: User):
    """Этапы, видимые пользователю в проекте.

    Заказчик и всё, что не исполнитель, видят все этапы. Ведущий исполнитель и
    прораб/владелец его бригады видят все этапы проекта: `assignee_id` не
    выставляется ни одним потоком, и прежняя «только свои» выдача оставляла
    прорабу 0 этапов (STG-005). Рядовой участник и наблюдатель бригады видят
    свои и неназначенные этапы; чужой исполнитель — по прежнему правилу.
    """
    if user.role != UserRole.contractor:
        return sorted(p.stages or [], key=lambda x: x.sort_order)
    from app.services import team_service

    role = await team_service.team_role_for_project(db, user, p)
    if role in ("owner", "foreman"):
        return sorted(p.stages or [], key=lambda x: x.sort_order)
    if role in ("member", "viewer"):
        return [
            s for s in sorted(p.stages or [], key=lambda x: x.sort_order)
            if getattr(s, "assignee_id", None) in (None, user.id)
        ]
    return _filter_stages_for_user(p, user)


def _project_out(
    p,
    *,
    access_mode: str = "owner",
    technical_capabilities: list[str] | None = None,
) -> ProjectOut:
    payments = getattr(p, "payments", None) or []
    pending = sum(1 for pay in payments if pay.status == PaymentStatus.pending)
    # customer_budget — приватный лимит заказчика: исполнителю, команде, гостю
    # и технадзору он не отдаётся (ROLE-001); mobile трактует null как «не задан».
    customer_budget = getattr(p, "customer_budget", None) if access_mode == "owner" else None
    # Независимый исполнитель (participant) не видит деньги заказчика и проекта.
    hide_money = access_mode == "participant"
    if hide_money:
        pending = 0
    return ProjectOut(
        id=p.id,
        name=p.name,
        address=p.address,
        renovation_type=p.renovation_type,
        property_type=getattr(p, "property_type", "apartment") or "apartment",
        budget_planned=0.0 if hide_money else p.budget_planned,
        budget_spent=0.0 if hide_money else p.budget_spent,
        customer_budget=float(customer_budget) if customer_budget is not None else None,
        notes=(getattr(p, "notes", None) if access_mode in {"owner", "contractor"} else None),
        # JRN-018: колонка projects.progress_percent никем не обновляется и всегда
        # 0 — считаем по этапам тем же взвешенным методом, что и дашборд.
        progress_percent=stage_status_svc.weighted_progress(list(p.stages or [])),
        vat_rate=float(getattr(p, "vat_rate", 0) or 0),
        rooms_count=len(p.rooms) if p.rooms else 0,
        stages_count=len(p.stages) if p.stages else 0,
        planned_start_date=p.planned_start_date.isoformat() if p.planned_start_date else None,
        planned_end_date=p.planned_end_date.isoformat() if p.planned_end_date else None,
        pending_payments=pending or None,
        is_archived=bool(getattr(p, "is_archived", False)),
        trashed_at=p.trashed_at.isoformat() if getattr(p, "trashed_at", None) else None,
        estimate_locked_at=p.estimate_locked_at.isoformat() if getattr(p, "estimate_locked_at", None) else None,
        estimate_lock_proposed_at=p.estimate_lock_proposed_at.isoformat() if getattr(p, "estimate_lock_proposed_at", None) else None,
        estimate_lock_proposed_by=getattr(p, "estimate_lock_proposed_by", None),
        access_mode=access_mode,
        technical_capabilities=technical_capabilities or [],
    )


async def _project_out_for_user(db, user: User, p) -> ProjectOut:
    access_mode, _read_only, capabilities = await supervision.project_access_descriptor(
        db, user=user, project=p
    )
    return _project_out(
        p,
        access_mode=access_mode,
        technical_capabilities=capabilities,
    )


def _lifecycle_http_error(e: ValueError) -> HTTPException:
    code = str(e)
    if code == "forbidden":
        return HTTPException(403, "Только владелец объекта может выполнить это действие")
    if code == "trashed":
        return HTTPException(409, "Объект в корзине — восстановите или удалите навсегда")
    if code == "not_found":
        return HTTPException(404, "Проект не найден")
    return HTTPException(404, "Проект не найден")


async def _detail(db, p, user: User | None = None) -> ProjectDetail:
    read_only, access_mode, capabilities = False, "owner", []
    if user:
        access_mode, read_only, capabilities = await supervision.project_access_descriptor(
            db, user=user, project=p
        )

    participant_stage_ids: set[str] | None = None
    participant_room_ids: set[str] = set()
    if user and access_mode == "participant":
        from app.services import project_participant_service as part_svc

        participant_stage_ids, participant_room_ids = await part_svc.participant_visible_scope(
            db, project=p, user_id=user.id
        )
    hide_money = participant_stage_ids is not None

    lines = [
        EstimateLineOut(
            id=l.id,
            line_type=l.line_type.value,
            name=l.name,
            unit=l.unit,
            quantity_planned=l.quantity_planned,
            quantity_actual=l.quantity_actual,
            unit_price=0.0 if hide_money else l.unit_price,
            room_name=l.room_name,
            room_id=l.room_id,
            category=l.category,
            calc_detail=None if hide_money else l.calc_detail,
            total=0.0 if hide_money else round(l.quantity_planned * l.unit_price, 2),
        )
        for l in p.estimate_lines
        if not hide_money or (l.room_id and l.room_id in participant_room_ids)
    ]
    stage_source = (
        sorted(p.stages or [], key=lambda x: x.sort_order)
        if user is None or access_mode == "supervisor"
        else (
            [s for s in sorted(p.stages or [], key=lambda x: x.sort_order) if s.id in participant_stage_ids]
            if hide_money
            else await visible_stages_for_user(db, p, user)
        )
    )
    stages = [
        StageOut(
            id=s.id,
            name=s.name,
            sort_order=s.sort_order,
            status=s.status.value,
            percent_complete=s.percent_complete,
            payment_amount=0.0 if hide_money else s.payment_amount,
            weight_coefficient=getattr(s, 'weight_coefficient', 0) or 0,
            planned_start=s.planned_start.isoformat() if s.planned_start else None,
            planned_end=s.planned_end.isoformat() if s.planned_end else None,
            contractor_ready=s.contractor_ready,
            customer_accepted_at=s.customer_accepted_at.isoformat() if s.customer_accepted_at else None,
            needs_rework=getattr(s, 'needs_rework', False),
            rework_deadline=s.rework_deadline.isoformat() if getattr(s, 'rework_deadline', None) else None,
            work_type=getattr(s, 'work_type', None),
            room_ids=parse_room_ids(s),
            assignee_id=getattr(s, "assignee_id", None),
            actual_start=s.actual_start.isoformat() if getattr(s, "actual_start", None) else None,
            actual_end=s.actual_end.isoformat() if getattr(s, "actual_end", None) else None,
        )
        for s in stage_source
    ]
    rooms = [
        RoomOut(**room_svc.room_detail(r))
        for r in p.rooms
        if not getattr(r, "is_archived", False)
        and (not hide_money or r.id in participant_room_ids)
    ] if p.rooms else []
    return ProjectDetail(
        **_project_out(
            p,
            access_mode=access_mode,
            technical_capabilities=capabilities,
        ).model_dump(),
        estimate_lines=lines,
        stages=stages,
        rooms=rooms,
        read_only=read_only,
    )


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    bucket: str = "active",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if bucket not in ("active", "archived", "trashed"):
        bucket = "active"
    base = await svc.list_projects_for_user(db, user, bucket=bucket)
    supervised = await supervision.list_supervised_projects(
        db, user_id=user.id, bucket=bucket
    )
    projects = list(base)
    seen = {project.id for project in projects}
    for project in supervised:
        if project.id not in seen:
            projects.append(project)
            seen.add(project.id)
    projects.sort(key=lambda project: project.created_at, reverse=True)
    return [await _project_out_for_user(db, user, p) for p in projects]


@router.post("", response_model=ProjectDetail)
async def create_project(body: ProjectCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.customer:
        raise HTTPException(403, "Создавать проект может только заказчик")
    p = await svc.create_project(
        db,
        customer_id=user.id,
        name=body.name,
        address=body.address,
        renovation_type=body.renovation_type,
        property_type=body.property_type,
        total_area_sqm=body.total_area_sqm,
        planned_start_date=body.planned_start_date,
        planned_end_date=body.planned_end_date,
        rooms_data=[r.model_dump() for r in body.rooms],
    )
    return await _detail(db, p, user)


class ProjectFromTemplateIn(BaseModel):
    template_id: str
    name: str | None = None


@router.get("/templates")
async def list_templates(_user: User = Depends(get_current_user)):
    """W69 #42: каталог шаблонов объектов."""
    return {"items": svc.list_project_templates()}


@router.post("/from-template", response_model=ProjectDetail)
async def create_from_template(
    body: ProjectFromTemplateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W69 #42: создать объект из шаблона комнат + черновик сметы."""
    if user.role != UserRole.customer:
        raise HTTPException(403, "Создавать проект может только заказчик")
    try:
        p = await svc.create_project_from_template(
            db, customer_id=user.id, template_id=body.template_id, name=body.name,
        )
    except ValueError as exc:
        if str(exc) == "unknown_template":
            raise HTTPException(404, detail={"code": "unknown_template", "message": "Неизвестный шаблон"}) from exc
        raise
    return await _detail(db, p, user)


@router.post("/{project_id}/archive")
async def archive_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        p = await svc.archive_project(db, project_id, user)
    except ValueError as e:
        raise _lifecycle_http_error(e)
    return await _project_out_for_user(db, user, p)


@router.post("/{project_id}/unarchive")
async def unarchive_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        p = await svc.unarchive_project(db, project_id, user)
    except ValueError as e:
        raise _lifecycle_http_error(e)
    return await _project_out_for_user(db, user, p)


@router.post("/{project_id}/trash")
async def trash_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        p = await svc.trash_project(db, project_id, user)
    except ValueError as e:
        raise _lifecycle_http_error(e)
    return await _project_out_for_user(db, user, p)


@router.post("/{project_id}/restore")
async def restore_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        p = await svc.restore_project(db, project_id, user)
    except ValueError as e:
        raise _lifecycle_http_error(e)
    return await _project_out_for_user(db, user, p)


@router.delete("/trash/empty")
async def empty_trash(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.customer:
        raise HTTPException(403)
    if not await svc.user_owns_any_project(db, user.id):
        raise HTTPException(403, "Только владелец объекта может выполнить это действие")
    deleted, skipped = await svc.empty_trash_detailed(db, user)
    return {"deleted": len(deleted), "skipped": skipped}


@router.delete("/{project_id}")
async def purge_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await svc.purge_project(db, project_id, user)
    except svc.PurgeBlocked as e:
        raise HTTPException(409, {
            "code": e.code,
            "message": svc.purge_blocked_message(e.reasons),
            "reasons": e.reasons,
        })
    except ValueError as e:
        if str(e) == "not_trashed":
            raise HTTPException(400, "Сначала переместите объект в корзину")
        if str(e) == "legal_hold_blocks_purge":
            raise HTTPException(409, "Нельзя удалить объект — есть документы на юридическом удержании (legal hold)")
        raise _lifecycle_http_error(e)
    return {"ok": True}


@router.patch("/{project_id}", response_model=ProjectDetail)
async def patch_project(project_id: str, body: ProjectUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    # Название/адрес/даты/НДС/тип и лимит — параметры и деньги заказчика.
    # Исполнитель (лид, прораб, участник бригады) правит объект через
    # специализированные ручки (этапы, смета, закупки), а не профиль. ROLE-004.
    await require_project_owner(db, user, project, action="Изменить параметры и бюджет объекта")
    data = body.model_dump(exclude_unset=True)
    p = await profile_svc.update_project_profile(db, project, data)
    return await _detail(db, p, user)


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False, participant_ok=True)
    return await _detail(db, p, user)


@router.get("/{project_id}/dashboard")
async def dashboard(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    access_mode, _read_only, _capabilities = await supervision.project_access_descriptor(
        db, user=user, project=project
    )
    stages = (
        sorted(project.stages or [], key=lambda stage: stage.sort_order)
        if access_mode == "supervisor"
        else dashboard_svc.stages_for_user(project, user)
    )
    result = dashboard_svc.build_dashboard_read_model(project, stages=stages)
    role = (
        "supervisor"
        if access_mode == "supervisor"
        else (
            getattr(getattr(user, "role", None), "value", None)
            or str(getattr(user, "role", "") or "")
        )
    )
    return await dashboard_svc.enrich_dashboard_read_only(
        project_id,
        result,
        role=role,
    )


@router.post("/{project_id}/stages/{stage_id}/submit")
async def submit_stage(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель")
    stage, err = await svc.submit_stage_for_review(db, stage_id)
    if err:
        raise HTTPException(400, detail=err)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    return {"ok": True, "status": stage.status.value, "contractor_ready": stage.contractor_ready}


@router.post("/{project_id}/stages/{stage_id}/reject")
async def reject_stage(project_id: str, stage_id: str, body: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403, "Только заказчик")
    stage = await svc.reject_stage(db, stage_id, user.id, body.get("text"))
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    return {"ok": True, "status": stage.status.value}


@router.post("/{project_id}/stages/{stage_id}/accept")
async def accept_stage(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Deprecated: use POST /projects/{id}/work-acceptances/{acceptance_id}/accept."""
    await require_project(db, project_id, user, write=True)
    raise HTTPException(
        410,
        "Deprecated: use work-acceptances API",
        headers={"X-Deprecated-Use": "work-acceptances"},
    )


@router.post("/{project_id}/assign")
async def assign_contractor(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """W55: 404/409/402 раздельно — не маскировать «уже занят» под paywall."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель")
    existing = await svc.get_project(db, project_id)
    if not existing:
        raise HTTPException(404, "Объект не найден")
    if existing.contractor_id and existing.contractor_id != user.id:
        raise HTTPException(409, detail={"code": "already_assigned", "message": "На объекте уже другой исполнитель"})
    p = await svc.assign_contractor(db, project_id, user.id)
    if not p:
        raise HTTPException(402, detail={"code": "subscription_required", "message": "Нужен Pro для нового объекта"})
    return await _detail(db, p, user)


class ViewerShareIn(BaseModel):
    phone: str | None = None
    profile_code: str | None = None


class LinkContractorIn(BaseModel):
    contractor_id: str


@router.post("/{project_id}/contractor")
async def link_contractor(project_id: str, body: LinkContractorIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import User as U, UserRole
    p = await require_project(db, project_id, user, write=True)
    if user.id != p.customer_id:
        raise HTTPException(403, "Только заказчик")
    r = await db.execute(select(U).where(U.id == body.contractor_id, U.role == UserRole.contractor))
    contractor = r.scalar_one_or_none()
    if not contractor:
        raise HTTPException(404, "Исполнитель не найден")
    linked = await svc.assign_contractor(db, project_id, contractor.id)
    if not linked:
        raise HTTPException(409, "На объекте уже другой исполнитель или нужен Pro у подрядчика")
    return await _detail(db, linked, user)


@router.get("/{project_id}/viewers")
async def list_viewers(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import ProjectViewer
    p = await require_project(db, project_id, user, write=False)
    if user.id != p.customer_id:
        raise HTTPException(403, "Только заказчик")
    rows = (await db.execute(select(ProjectViewer, User).join(User, User.id == ProjectViewer.user_id).where(ProjectViewer.project_id == project_id))).all()
    return [{"user_id": u.id, "phone": u.phone, "full_name": u.full_name, "role": u.role.value} for _, u in rows]


@router.post("/{project_id}/viewers")
async def share_viewer(project_id: str, body: ViewerShareIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import User as U
    p = await require_project(db, project_id, user, write=True)
    if user.id != p.customer_id:
        raise HTTPException(403, "Только заказчик")
    target = None
    phone = (body.phone or "").strip()
    code = (body.profile_code or "").strip().upper()
    if phone:
        r = await db.execute(select(U).where(U.phone == phone))
        target = r.scalar_one_or_none()
    elif code:
        r = await db.execute(select(U).where(U.profile_code == code))
        target = r.scalar_one_or_none()
    if not phone and not code:
        raise HTTPException(400, "Укажите телефон или код профиля")
    if not target:
        raise HTTPException(404, "Пользователь не найден. Попросите гостя войти в Renova по SMS.")
    if viewer_svc.has_intrinsic_project_access(p, target.id):
        return {"ok": True, "message": "Уже имеет доступ", "user_id": target.id}
    _viewer, created = await viewer_svc.grant_project_viewer(
        db,
        project_id=project_id,
        user_id=target.id,
    )
    if not created:
        return {"ok": True, "message": "Уже имеет доступ", "user_id": target.id}
    return {"ok": True, "user_id": target.id, "full_name": target.full_name}


@router.get("/{project_id}/contract-gate")
async def get_contract_gate(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P3-W9: статус договора до start_stage — для баннера на экране этапа."""
    await require_project(db, project_id, user, write=False)
    return await docs_svc.project_contract_gate(db, project_id)


@router.post("/{project_id}/contract")
async def create_project_contract(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """«Создать договор»: когда гейт отвечает `no_contract`. Идемпотентно.

    Доступно только сторонам договора: заказчику и исполнителю-лиду проекта.
    """
    from app.services import contract_document_service as contract_svc

    project = await require_project(db, project_id, user, write=False)
    if docs_svc.signature_party(project, user.id) is None:
        raise HTTPException(403, "contract_parties_only")
    terms = await contract_svc.collect_terms(db, project_id)
    result = await docs_svc.ensure_contract_draft(db, project_id=project_id, created_by=user.id) if (
        terms is not None and terms.is_signable()
    ) else None
    if result is None:
        # Договор без предмета и цены создавать нечего: сначала смета.
        existing = await docs_svc.project_contract_gate(db, project_id)
        if existing.get("document_id"):
            return {"created": False, "document_id": existing["document_id"], "gate": existing}
        raise HTTPException(
            409,
            detail={"code": "estimate_not_ready", "message": "Сначала заполните смету: в ней нет позиций или сумма равна нулю."},
        )
    await db.commit()
    return {**result, "gate": await docs_svc.project_contract_gate(db, project_id)}


@router.delete("/{project_id}/viewers/{viewer_user_id}")
async def remove_viewer(project_id: str, viewer_user_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete
    from app.models.entities import ProjectViewer
    p = await require_project(db, project_id, user, write=True)
    if user.id != p.customer_id:
        raise HTTPException(403)
    await db.execute(delete(ProjectViewer).where(ProjectViewer.project_id == project_id, ProjectViewer.user_id == viewer_user_id))
    await db.commit()
    return {"ok": True}
