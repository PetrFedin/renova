from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import EstimateLine, User, UserRole
from app.models.entities import Project
from app.services.estimate_service import prepare_line, material_stats, update_line, lock_estimate, propose_estimate_lock, clear_estimate_proposal, get_estimate_lock_diff, import_estimate_csv
from app.services.client_write_idempotency import IdempotencyConflict, commit_client_write, replay_entity_id
from app.services import estimate_line_lifecycle_service as line_lifecycle

router = APIRouter(prefix="/projects/{project_id}/estimate", tags=["estimate"])
ESTIMATE_LINE_CREATE_SCOPE = "estimate_line.create"


def _idempotency_http_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


def _line_lifecycle_http_error(error: Exception) -> HTTPException:
    code = str(error)
    if code == "estimate_line_not_found":
        return HTTPException(404, detail={"code": code, "message": "Строка сметы не найдена"})
    if code == "estimate_locked":
        return HTTPException(
            409,
            detail={
                "code": code,
                "message": "Смета зафиксирована — изменения выполняются через доп. соглашение",
            },
        )
    if code == "estimate_line_system_managed":
        return HTTPException(
            409,
            detail={
                "code": code,
                "message": "Автоматическую строку нельзя убрать вручную — измените параметры помещения",
            },
        )
    return HTTPException(
        409,
        detail={
            "code": "estimate_line_lifecycle_inconsistent",
            "message": "Состояние строки требует восстановления перед повторной операцией",
        },
    )


class LinePatch(BaseModel):
    quantity_planned: float | None = None
    unit_price: float | None = None
    quantity_actual: float | None = None
    notes: str | None = Field(default=None, max_length=2000)


class LineCreate(BaseModel):
    line_type: str = Field(pattern="^(material|work)$")
    name: str
    unit: str = "pcs"
    quantity_planned: float = Field(gt=0)
    unit_price: float = Field(ge=0)
    room_id: str | None = None
    room_name: str | None = None
    category: str | None = None
    notes: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


async def _require_estimate_editable(db, project_id: str):
    project = await db.get(Project, project_id)
    if project and project.estimate_locked_at:
        raise HTTPException(409, detail={"code": "estimate_locked", "message": "Смета зафиксирована — правки через изменение сметы (CO)"})


@router.get("/lines/lifecycle")
async def estimate_line_lifecycle(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Active rows plus reversible tombstones; readable by either project side."""
    await require_project(db, project_id, user, write=False)
    return await line_lifecycle.lifecycle_view(db, project_id)


@router.patch("/lines/{line_id}")
async def patch_line(
    project_id: str,
    line_id: str,
    body: LinePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель редактирует смету")
    await require_project(db, project_id, user, write=True)
    await _require_estimate_editable(db, project_id)
    target = (
        await db.execute(
            select(EstimateLine).where(
                EstimateLine.id == line_id,
                EstimateLine.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(404, "Строка не найдена")

    lifecycle = await line_lifecycle.ensure_line_lifecycle(db, target)
    data = body.model_dump(exclude_unset=True)
    notes_present = "notes" in data
    notes = data.pop("notes", None)
    if notes_present:
        text = str(notes).strip() if notes is not None else ""
        target.notes = text or None

    numeric_patch = {key: value for key, value in data.items() if value is not None}
    if numeric_patch:
        line = await update_line(db, target.id, **numeric_patch)
        if not line:
            raise HTTPException(404, "Строка не найдена")
    else:
        await db.commit()
        await db.refresh(target)
        line = target
    return {
        "ok": True,
        **line_lifecycle.serialize_line(line, origin=lifecycle.origin),
    }


@router.post("/lines/{line_id}/remove")
async def remove_estimate_line(
    project_id: str,
    line_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_required"})
    await require_project(db, project_id, user, write=True)
    try:
        line, replayed = await line_lifecycle.remove_line(
            db,
            project_id=project_id,
            line_id=line_id,
            actor_id=user.id,
        )
    except (ValueError, RuntimeError) as exc:
        raise _line_lifecycle_http_error(exc) from exc
    return {"ok": True, "idempotent_replay": replayed, **line}


@router.post("/lines/{line_id}/restore")
async def restore_estimate_line(
    project_id: str,
    line_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_required"})
    await require_project(db, project_id, user, write=True)
    try:
        line, replayed = await line_lifecycle.restore_line(
            db,
            project_id=project_id,
            line_id=line_id,
            actor_id=user.id,
        )
    except (ValueError, RuntimeError) as exc:
        raise _line_lifecycle_http_error(exc) from exc
    return {"ok": True, "idempotent_replay": replayed, **line}


@router.post("/lines")
async def create_line(
    project_id: str,
    body: LineCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только исполнитель")
    await require_project(db, project_id, user, write=True)
    await _require_estimate_editable(db, project_id)

    payload = body.model_dump(exclude={"client_request_id"})
    try:
        replay_id = await replay_entity_id(
            db,
            scope=ESTIMATE_LINE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc

    if replay_id:
        line = await db.get(EstimateLine, replay_id)
        if not line or line.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        lifecycle = await line_lifecycle.ensure_line_lifecycle(db, line, origin=line_lifecycle.MANUAL)
        return {
            "ok": True,
            "id": line.id,
            "origin": lifecycle.origin,
            "idempotent_replay": True,
        }

    line = await prepare_line(db, project_id, payload)
    await line_lifecycle.ensure_line_lifecycle(db, line, origin=line_lifecycle.MANUAL)
    from app.services.budget_service import sync_project_budget_planned
    await sync_project_budget_planned(db, project_id)
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=ESTIMATE_LINE_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=line.id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    if not created:
        line = await db.get(EstimateLine, entity_id)
        if not line:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
    return {
        "ok": True,
        "id": line.id,
        "origin": line_lifecycle.MANUAL,
        "idempotent_replay": not created,
    }


class EstimateCsvImport(BaseModel):
    csv_text: str = Field(min_length=1, max_length=500_000)


@router.post("/import-csv")
async def import_csv_lines(
    project_id: str,
    body: EstimateCsvImport,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W71: импорт сметы из CSV (Excel → CSV). Только исполнитель, смета не locked."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Импорт сметы — только исполнитель")
    await require_project(db, project_id, user, write=True)
    await _require_estimate_editable(db, project_id)
    before_ids = set(
        (
            await db.execute(
                select(EstimateLine.id).where(EstimateLine.project_id == project_id)
            )
        ).scalars().all()
    )
    try:
        result = await import_estimate_csv(db, project_id, body.csv_text)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if result.get("created"):
        imported = list(
            (
                await db.execute(
                    select(EstimateLine).where(
                        EstimateLine.project_id == project_id,
                        EstimateLine.id.not_in(before_ids) if before_ids else True,
                    )
                )
            ).scalars().all()
        )
        for line in imported:
            await line_lifecycle.ensure_line_lifecycle(
                db,
                line,
                origin=line_lifecycle.IMPORTED,
            )
        await db.commit()
    return {"ok": True, **result}


@router.get("/materials-stats")
async def materials_stats(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=False)
    return material_stats(project.estimate_lines)


@router.get("/lock-diff")
async def estimate_lock_diff(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """W68 #39: изменения сметы с момента propose (для заказчика перед lock)."""
    await require_project(db, project_id, user, write=False)
    diff = await get_estimate_lock_diff(db, project_id)
    if not diff:
        raise HTTPException(404, "Проект не найден")
    return diff


@router.post("/propose-lock")
async def propose_project_estimate_lock(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """W57: исполнитель отправляет смету на согласование (без estimate_locked_at)."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Предложить фиксацию может только исполнитель")
    project = await require_project(db, project_id, user, write=True)
    if project.contractor_id and project.contractor_id != user.id:
        raise HTTPException(
            403,
            detail={
                "code": "contractor_owner_required",
                "message": "Отправить смету на фиксацию может только главный исполнитель объекта",
            },
        )
    project, result = await propose_estimate_lock(db, project_id, proposed_by=user.id)
    if not project:
        code = result.get("code")
        if code == "empty_estimate":
            raise HTTPException(400, detail=result)
        raise HTTPException(404, "Проект не найден")
    if result.get("code") == "already_locked":
        raise HTTPException(409, detail=result)
    return {
        "ok": True,
        "code": "proposed",
        "estimate_lock_proposed_at": project.estimate_lock_proposed_at.isoformat() if project.estimate_lock_proposed_at else None,
        "estimate_locked_at": None,
    }


@router.post("/lock")
async def lock_project_estimate(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """W57: фиксацию подтверждает только заказчик."""
    if user.role != UserRole.customer:
        raise HTTPException(403, detail={"code": "customer_lock_required", "message": "Фиксацию сметы подтверждает заказчик"})
    await require_project(db, project_id, user, write=True)
    project, result = await lock_estimate(db, project_id, locked_by=user.id)
    if not project:
        code = result.get("code")
        if code == "empty_estimate":
            raise HTTPException(400, detail=result)
        raise HTTPException(404, "Проект не найден")
    if result.get("code") == "already_locked":
        raise HTTPException(409, detail=result)
    if result.get("code") == "customer_lock_required":
        raise HTTPException(403, detail=result)
    if result.get("code") == "proposal_required":
        raise HTTPException(409, detail=result)
    return {
        "ok": True,
        "estimate_locked_at": project.estimate_locked_at.isoformat() if project.estimate_locked_at else None,
        "contract": result.get("contract"),
    }


class EstimateProposalClearIn(BaseModel):
    reason: str | None = None


@router.post("/reject-lock")
async def reject_project_estimate_lock(
    project_id: str,
    body: EstimateProposalClearIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W65: заказчик отклоняет propose-lock."""
    if user.role != UserRole.customer:
        raise HTTPException(403, detail={"code": "customer_reject_required"})
    await require_project(db, project_id, user, write=True)
    project, result = await clear_estimate_proposal(
        db, project_id, cleared_by=user.id, reason=(body.reason if body else None), mode="reject",
    )
    if not project:
        raise HTTPException(404, "Проект не найден")
    if result.get("code") == "already_locked":
        raise HTTPException(409, detail=result)
    if result.get("code") == "no_proposal":
        raise HTTPException(409, detail=result)
    if result.get("code") == "customer_reject_required":
        raise HTTPException(403, detail=result)
    return {"ok": True, "code": "cleared", "mode": "reject"}


@router.post("/withdraw-lock")
async def withdraw_project_estimate_lock(
    project_id: str,
    body: EstimateProposalClearIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W65: исполнитель отзывает propose-lock."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_withdraw_required"})
    await require_project(db, project_id, user, write=True)
    project, result = await clear_estimate_proposal(
        db, project_id, cleared_by=user.id, reason=(body.reason if body else None), mode="withdraw",
    )
    if not project:
        raise HTTPException(404, "Проект не найден")
    if result.get("code") in ("already_locked", "no_proposal"):
        raise HTTPException(409, detail=result)
    if result.get("code") == "contractor_withdraw_required":
        raise HTTPException(403, detail=result)
    return {"ok": True, "code": "cleared", "mode": "withdraw"}
