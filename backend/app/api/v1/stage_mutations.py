"""Canonical stage create/start/configuration routes."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import stage_mutation_service as mutations
from app.services import stage_review_service
from app.services import stage_service
from app.services.project_role_policy import require_project_owner

router = APIRouter(prefix="/projects", tags=["stages"])


class StageCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    planned_start: date | None = None
    planned_end: date | None = None
    room_ids: list[str] | None = None
    work_type: str | None = Field(default=None, max_length=64)
    client_request_id: str | None = Field(default=None, max_length=80)


class StageDatesIn(BaseModel):
    planned_start: date | None = None
    planned_end: date | None = None


class StageRoomsIn(BaseModel):
    room_ids: list[str] = Field(default_factory=list)


class StageWorkTypeIn(BaseModel):
    work_type: str | None = Field(default=None, max_length=64)


class StageDependencyIn(BaseModel):
    depends_on_stage_id: str | None = None


class StageAssigneeIn(BaseModel):
    assignee_id: str | None = None


def _mutation_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {
        "stage_schedule_actor_forbidden",
        "stage_execution_actor_forbidden",
        "stage_submit_actor_forbidden",
    }:
        return HTTPException(403, detail={"code": code})
    if isinstance(error, mutations.StageDeleteBlocked):
        return HTTPException(
            409,
            detail={
                "code": "stage_delete_blocked",
                "message": "; ".join(b["message"] for b in error.blockers),
                "blockers": error.blockers,
            },
        )
    if code in {
        "confirmed_schedule_controls_dates",
        "stage_dates_locked_done",
        "stage_configuration_locked",
        "stage_dependency_cycle",
        "stage_dates_locked_done",
        "idempotency_conflict",
    }:
        return HTTPException(409, detail={"code": code})
    if code in {"project_not_found", "stage_entity_missing"}:
        return HTTPException(404, detail={"code": code})
    return HTTPException(422, detail={"code": code})


async def _stage_response(
    db: AsyncSession,
    result: mutations.StageMutationResult,
) -> dict:
    loaded = await stage_service.get_stage_full(db, result.stage.id)
    if loaded is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    response = stage_service.stage_to_dict(loaded)
    response["replayed"] = result.replayed
    return response


@router.post("/{project_id}/stages")
async def create_stage(
    project_id: str,
    body: StageCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.create_stage(
            db,
            project_id=project_id,
            actor=user,
            name=body.name,
            planned_start=body.planned_start,
            planned_end=body.planned_end,
            room_ids=body.room_ids,
            work_type=body.work_type,
            client_request_id=body.client_request_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    return await _stage_response(db, result)


@router.post("/{project_id}/stages/{stage_id}/start")
async def start_stage(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(
        db, project_id, user, write=True, participant_ok=True, stage_id=stage_id
    )
    try:
        result, error = await mutations.start_stage(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
        )
    except ValueError as exc:
        raise _mutation_error(exc) from exc
    if result is not None:
        return await _stage_response(db, result)

    code = (error or {}).get("code", "stage_start_failed")
    if code in {"project_not_found", "stage_not_found"}:
        raise HTTPException(404, detail=error)
    if code in {"contract_not_signed", "contract_required"}:
        raise HTTPException(403, detail=error)
    if code in {"blocked", "stage_start_invalid_status"}:
        raise HTTPException(409, detail=error)
    raise HTTPException(422, detail=error)


@router.post("/{project_id}/stages/{stage_id}/ready")
async def mark_ready(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(
        db, project_id, user, write=True, participant_ok=True, stage_id=stage_id
    )
    try:
        result, error = await stage_review_service.submit_for_review(
            db,
            project=project,
            stage_id=stage_id,
            actor=user,
        )
    except ValueError as exc:
        raise _mutation_error(exc) from exc
    if result is None:
        if error is None:
            raise HTTPException(404, detail={"code": "stage_not_found"})
        if error.get("code") == "completion_gate":
            raise HTTPException(422, detail=error)
        raise HTTPException(409, detail=error)

    acceptance_id = result.acceptance.id
    acceptance_status = result.acceptance.status
    response = await _stage_response(
        db,
        mutations.StageMutationResult(result.stage, result.replayed),
    )
    response.update(
        {
            "acceptance_id": acceptance_id,
            "acceptance_status": acceptance_status,
        }
    )
    return response


class StagePaymentPlanIn(BaseModel):
    """Ручное распределение цены договора по этапам."""

    amounts: dict[str, float] = Field(
        ..., description="Идентификатор этапа → сумма к оплате, ₽"
    )


@router.get("/{project_id}/stages/payment-plan")
async def get_payment_plan(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Порядок оплаты по этапам и его сходимость с ценой договора."""
    from sqlalchemy import select

    from app.models.entities import Stage
    from app.services import stage_payment_plan_service as pay_plan

    project = await require_project(db, project_id, user, write=False)
    stages = list(
        (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    )
    stages.sort(key=lambda item: getattr(item, "sort_order", 0) or 0)
    amounts = [float(stage.payment_amount or 0) for stage in stages]
    total = float(project.budget_planned or 0)
    return {
        "total": round(total, 2),
        "distributed": round(sum(amounts), 2),
        # Нераспределённое показываем числом, а не флагом: «не сходится» без
        # суммы не говорит, насколько именно.
        "undistributed": pay_plan.undistributed(total, amounts),
        "matches_total": pay_plan.plan_matches_total(total, amounts),
        "stages": [
            {
                "id": stage.id,
                "name": stage.name,
                "sort_order": getattr(stage, "sort_order", 0) or 0,
                "weight_coefficient": float(stage.weight_coefficient or 0),
                "payment_amount": float(stage.payment_amount or 0),
            }
            for stage in stages
        ],
    }


@router.patch("/{project_id}/stages/payment-plan")
async def update_payment_plan(
    project_id: str,
    body: StagePaymentPlanIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Поправить суммы по этапам вручную.

    Разнесение по весам — умолчание, а не приговор: заказчик вправе
    распределить иначе. Суммы становятся счетами заказчику при приёмке, поэтому
    (STG-001, MNY-001, APIB-008):
      * правит только заказчик-владелец; исполнитель и бригада план видят,
        но не устанавливают (предложить сумму можно через чат/комментарий);
      * отрицательных сумм не бывает, этап должен принадлежать объекту;
      * итог по всем этапам не может превышать цену договора (422);
      * сумму этапа на проверке/после приёмки не меняют (409).
    """
    from sqlalchemy import select

    from app.models.entities import Stage

    project = await require_project(db, project_id, user, write=True)
    await require_project_owner(db, user, project, action="Менять порядок оплаты по этапам")
    stages = {
        stage.id: stage
        for stage in (
            await db.execute(select(Stage).where(Stage.project_id == project_id))
        ).scalars().all()
    }
    unknown = sorted(set(body.amounts) - set(stages))
    if unknown:
        raise HTTPException(
            404,
            detail={"code": "stage_not_found", "message": "Этап не найден в этом объекте", "ids": unknown},
        )
    negative = sorted(sid for sid, amount in body.amounts.items() if amount < 0)
    if negative:
        raise HTTPException(
            422,
            detail={"code": "negative_amount", "message": "Сумма по этапу не может быть отрицательной", "ids": negative},
        )
    from app.models.entities import StageStatus

    locked = sorted(
        sid
        for sid, amount in body.amounts.items()
        if stages[sid].status in (StageStatus.review, StageStatus.done)
        and round(float(amount), 2) != round(float(stages[sid].payment_amount or 0), 2)
    )
    if locked:
        raise HTTPException(
            409,
            detail={
                "code": "stage_payment_locked",
                "message": "Сумму этапа на проверке или после приёмки менять нельзя",
                "ids": locked,
            },
        )
    resulting = {
        sid: round(float(body.amounts[sid]), 2) if sid in body.amounts else float(stage.payment_amount or 0)
        for sid, stage in stages.items()
    }
    total = round(float(project.budget_planned or 0), 2)
    distributed = round(sum(resulting.values()), 2)
    if distributed > total + 0.005:
        raise HTTPException(
            422,
            detail={
                "code": "payment_plan_exceeds_total",
                "message": (
                    f"Сумма по этапам ({distributed:.2f} ₽) больше цены договора ({total:.2f} ₽) "
                    f"на {distributed - total:.2f} ₽"
                ),
                "total": total,
                "distributed": distributed,
            },
        )
    for stage_id, amount in body.amounts.items():
        stages[stage_id].payment_amount = round(float(amount), 2)
    await db.commit()
    return await get_payment_plan(project_id, user=user, db=db)


@router.patch("/{project_id}/stages/{stage_id}/dates")
async def update_dates(
    project_id: str,
    stage_id: str,
    body: StageDatesIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_dates(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            planned_start=body.planned_start,
            planned_end=body.planned_end,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.patch("/{project_id}/stages/{stage_id}/rooms")
async def update_rooms(
    project_id: str,
    stage_id: str,
    body: StageRoomsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_rooms(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            room_ids=body.room_ids,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.patch("/{project_id}/stages/{stage_id}/work-type")
async def update_work_type(
    project_id: str,
    stage_id: str,
    body: StageWorkTypeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_work_type(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            work_type=body.work_type,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.patch("/{project_id}/stages/{stage_id}/depends")
async def update_dependency(
    project_id: str,
    stage_id: str,
    body: StageDependencyIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.update_dependency(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            depends_on_stage_id=body.depends_on_stage_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)


@router.post("/{project_id}/dependencies/sync")
async def sync_dependencies(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        count = await mutations.sync_dependencies(
            db,
            project_id=project_id,
            actor=user,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    return {"created": count}


@router.delete("/{project_id}/dependencies/{dependency_id}")
async def remove_dependency(
    project_id: str,
    dependency_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Снять зависимость (этап/материал), пока зависимый этап не начат."""
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.remove_dependency(
            db, project_id=project_id, dependency_id=dependency_id, actor=user
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "dependency_not_found"})
    return result


@router.delete("/{project_id}/stages/{stage_id}")
async def delete_stage(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отменить (удалить) не начатый этап; начатый или с приёмками/платежами — 409."""
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.delete_stage(
            db, project_id=project_id, stage_id=stage_id, actor=user
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return result


@router.patch("/{project_id}/stages/{stage_id}/assignee")
async def update_assignee(
    project_id: str,
    stage_id: str,
    body: StageAssigneeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Назначить этап участнику бригады ведущего (или вернуть ведущему)."""
    await require_project(db, project_id, user, write=True)
    try:
        result = await mutations.set_assignee(
            db,
            project_id=project_id,
            stage_id=stage_id,
            actor=user,
            assignee_id=body.assignee_id,
        )
    except ValueError as error:
        raise _mutation_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "stage_not_found"})
    return await _stage_response(db, result)
