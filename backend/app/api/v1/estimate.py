from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import EstimateLine, User, UserRole
from app.models.entities import Project
from app.services.estimate_service import prepare_line, material_stats, update_line, lock_estimate, propose_estimate_lock, clear_estimate_proposal, get_estimate_lock_diff, import_estimate_csv
from app.services.client_write_idempotency import IdempotencyConflict, commit_client_write, replay_entity_id

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


class LinePatch(BaseModel):
    quantity_planned: float | None = None
    unit_price: float | None = None
    quantity_actual: float | None = None


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
    line = await update_line(db, line_id, **body.model_dump(exclude_none=True))
    if not line:
        raise HTTPException(404, "Строка не найдена")
    return {"ok": True, "id": line.id}


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
        return {"ok": True, "id": line.id, "idempotent_replay": True}

    line = await prepare_line(db, project_id, payload)
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
    return {"ok": True, "id": line.id, "idempotent_replay": not created}


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
    try:
        result = await import_estimate_csv(db, project_id, body.csv_text)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
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
