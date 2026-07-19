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
from app.services.stage_service import parse_room_ids
from app.services import room_service as room_svc
from app.services import project_document_service as docs_svc

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



def _project_out(p, *, access_mode: str = "owner") -> ProjectOut:
    payments = getattr(p, "payments", None) or []
    pending = sum(1 for pay in payments if pay.status == PaymentStatus.pending)
    return ProjectOut(
        id=p.id,
        name=p.name,
        address=p.address,
        renovation_type=p.renovation_type,
        property_type=getattr(p, "property_type", "apartment") or "apartment",
        budget_planned=p.budget_planned,
        budget_spent=p.budget_spent,
        progress_percent=p.progress_percent,
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
    )


async def _project_out_for_user(db, user: User, p) -> ProjectOut:
    from app.services import team_service as team_svc

    access_mode, _read_only = await team_svc.project_access_mode(db, user, p)
    return _project_out(p, access_mode=access_mode)


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
    lines = [
        EstimateLineOut(
            id=l.id,
            line_type=l.line_type.value,
            name=l.name,
            unit=l.unit,
            quantity_planned=l.quantity_planned,
            quantity_actual=l.quantity_actual,
            unit_price=l.unit_price,
            room_name=l.room_name,
            room_id=l.room_id,
            category=l.category,
            calc_detail=l.calc_detail,
            total=round(l.quantity_planned * l.unit_price, 2),
        )
        for l in p.estimate_lines
    ]
    stages = [
        StageOut(
            id=s.id,
            name=s.name,
            sort_order=s.sort_order,
            status=s.status.value,
            percent_complete=s.percent_complete,
            payment_amount=s.payment_amount,
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
        for s in (_filter_stages_for_user(p, user) if user else sorted(p.stages or [], key=lambda x: x.sort_order))
    ]
    rooms = [RoomOut(**room_svc.room_detail(r)) for r in p.rooms if not getattr(r, "is_archived", False)] if p.rooms else []
    read_only, access_mode = False, "owner"
    if user:
        from app.services import team_service as team_svc
        access_mode, read_only = await team_svc.project_access_mode(db, user, p)
    return ProjectDetail(
        **_project_out(p, access_mode=access_mode).model_dump(),
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
    projects = await svc.list_projects_for_user(db, user, bucket=bucket)
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
    n = await svc.empty_trash(db, user)
    return {"deleted": n}


@router.delete("/{project_id}")
async def purge_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await svc.purge_project(db, project_id, user)
    except ValueError as e:
        if str(e) == "not_trashed":
            raise HTTPException(400, "Сначала переместите объект в корзину")
        raise _lifecycle_http_error(e)
    return {"ok": True}

@router.patch("/{project_id}", response_model=ProjectDetail)
async def patch_project(project_id: str, body: ProjectUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    data = body.model_dump(exclude_unset=True)
    p = await svc.update_project(db, project_id, **data)
    if not p:
        raise HTTPException(404)
    return await _detail(db, p, user)

@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    return await _detail(db, p, user)


@router.get("/{project_id}/dashboard")
async def dashboard(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    if user.role == UserRole.contractor:
        p.stages = _filter_stages_for_user(p, user)
    from app.models.entities import MarginSnapshot
    dash = svc.build_dashboard(p)
    try:
        margin = p.budget_planned - p.budget_spent
        db.add(MarginSnapshot(project_id=project_id, margin_estimated=margin))
        await db.commit()
    except Exception:
        pass
    return dash


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
    await require_project(db, project_id, user, write=False)
    p = await svc.get_project(db, project_id)
    if user.id != p.customer_id:
        raise HTTPException(403, "Только заказчик")
    rows = (await db.execute(select(ProjectViewer, User).join(User, User.id == ProjectViewer.user_id).where(ProjectViewer.project_id == project_id))).all()
    return [{"user_id": u.id, "phone": u.phone, "full_name": u.full_name, "role": u.role.value} for _, u in rows]


@router.post("/{project_id}/viewers")
async def share_viewer(project_id: str, body: ViewerShareIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.entities import ProjectViewer, User as U
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
        raise HTTPException(404, "Пользователь не найден. Попросите гостя войти в Renova (demo или SMS).")
    ex = await db.execute(select(ProjectViewer).where(ProjectViewer.project_id == project_id, ProjectViewer.user_id == target.id))
    if ex.scalar_one_or_none():
        return {"ok": True, "message": "Уже имеет доступ", "user_id": target.id}
    db.add(ProjectViewer(project_id=project_id, user_id=target.id))
    await db.commit()
    return {"ok": True, "user_id": target.id, "full_name": target.full_name}



@router.get("/{project_id}/contract-gate")
async def get_contract_gate(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P3-W9: статус договора до start_stage — для баннера на экране этапа."""
    await require_project(db, project_id, user, write=False)
    return await docs_svc.project_contract_gate(db, project_id)

@router.delete("/{project_id}/viewers/{viewer_user_id}")
async def remove_viewer(project_id: str, viewer_user_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select, delete
    from app.models.entities import ProjectViewer
    p = await require_project(db, project_id, user, write=True)
    if user.id != p.customer_id:
        raise HTTPException(403)
    await db.execute(delete(ProjectViewer).where(ProjectViewer.project_id == project_id, ProjectViewer.user_id == viewer_user_id))
    await db.commit()
    return {"ok": True}

