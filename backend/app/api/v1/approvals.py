from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import (
    ChangeOrder,
    ChangeOrderStatus,
    DesignPackage,
    MaterialPick,
    MaterialPickStatus,
    Project,
    RoomChangeRequest,
    RoomChangeStatus,
    User,
    WasteOrder,
    WasteOrderStatus,
)
from app.services import approval_decision_service as decision_svc
from app.services import team_service

router = APIRouter(prefix="/projects", tags=["approvals"])

ApprovalType = Literal[
    "material",
    "change_order",
    "room_change",
    "design",
    "waste",
]


class ApproveIn(BaseModel):
    type: ApprovalType


class RejectIn(BaseModel):
    type: ApprovalType
    reason: str = Field(default="", max_length=1000)


def _status(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _decision_error(error: ValueError) -> HTTPException:
    code = str(error)
    if code in {
        "approval_customer_required",
        "design_decision_actor_forbidden",
        "room_change_actor_forbidden",
        "waste_order_actor_forbidden",
    }:
        return HTTPException(
            403,
            detail={"code": code, "message": "Решение недоступно для вашей роли"},
        )
    if code == "unknown_approval_type":
        return HTTPException(400, detail={"code": code})
    if code.startswith("room_patch_") or code in {
        "room_change_payload_invalid",
        "room_change_room_not_found",
    }:
        return HTTPException(
            422,
            detail={"code": code, "message": "Изменение комнаты содержит недопустимые данные"},
        )
    if (
        code.startswith("invalid_design_transition:")
        or code.startswith("invalid_waste_order_transition:")
        or code in {
            "room_change_final_state_conflict",
            "material_pick_transition_terminal",
            "material_pick_transition_invalid",
            "material_pick_locked_by_purchase",
        }
    ):
        return HTTPException(
            409,
            detail={"code": code, "message": "Объект уже изменён или переход недоступен"},
        )
    return HTTPException(409, detail={"code": code})


@router.get("/{project_id}/approvals")
async def approval_hub(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    items: list[dict] = []

    # Customer decisions: commercial scope and submitted design/material choices.
    if user.id == project.customer_id:
        material_rows = (
            await db.execute(
                select(MaterialPick).where(
                    MaterialPick.project_id == project_id,
                    MaterialPick.status == MaterialPickStatus.pending,
                )
            )
        ).scalars().all()
        for pick in material_rows:
            items.append(
                {
                    "id": pick.id,
                    "type": "material",
                    "title": pick.name,
                    "subtitle": f"{pick.qty:g} {pick.unit} · {round(pick.qty * pick.price)} ₽",
                    "status": _status(pick.status),
                    "room_id": pick.room_id,
                    "stage_id": pick.stage_id,
                    "work_type": pick.work_type,
                    "allowed_actions": ["approve", "reject"],
                }
            )

        change_rows = (
            await db.execute(
                select(ChangeOrder).where(
                    ChangeOrder.project_id == project_id,
                    ChangeOrder.status == ChangeOrderStatus.pending,
                )
            )
        ).scalars().all()
        for order in change_rows:
            items.append(
                {
                    "id": order.id,
                    "type": "change_order",
                    "title": order.title,
                    "subtitle": f"{order.amount:.0f} ₽",
                    "status": _status(order.status),
                    "room_id": None,
                    "work_type": None,
                    "allowed_actions": ["approve", "reject"],
                }
            )

        waste_rows = (
            await db.execute(
                select(WasteOrder).where(
                    WasteOrder.project_id == project_id,
                    WasteOrder.status == WasteOrderStatus.requested,
                )
            )
        ).scalars().all()
        for order in waste_rows:
            items.append(
                {
                    "id": order.id,
                    "type": "waste",
                    "title": f"Вывоз {order.volume_m3:g} м³",
                    "subtitle": order.notes or order.waste_type,
                    "status": _status(order.status),
                    "room_id": order.room_id,
                    "work_type": None,
                    "allowed_actions": ["approve", "reject"],
                }
            )

        design_rows = (
            await db.execute(
                select(DesignPackage).where(
                    DesignPackage.project_id == project_id,
                    DesignPackage.status == "pending",
                )
            )
        ).scalars().all()
        for package in design_rows:
            items.append(
                {
                    "id": package.id,
                    "type": "design",
                    "title": package.title,
                    "subtitle": f"v{package.version}",
                    "status": str(package.status),
                    "room_id": None,
                    "work_type": None,
                    "allowed_actions": ["approve", "reject"],
                }
            )

    # Room changes are customer requests resolved by the assigned executor.
    if (await team_service.team_role_for_project(db, user, project)) in {"owner", "foreman"}:
        room_rows = (
            await db.execute(
                select(RoomChangeRequest).where(
                    RoomChangeRequest.project_id == project_id,
                    RoomChangeRequest.status == RoomChangeStatus.pending,
                )
            )
        ).scalars().all()
        for request in room_rows:
            items.append(
                {
                    "id": request.id,
                    "type": "room_change",
                    "title": "Изменение комнаты",
                    "subtitle": request.message[:80],
                    "status": _status(request.status),
                    "room_id": request.room_id,
                    "work_type": None,
                    "allowed_actions": ["approve", "reject"],
                }
            )

    return {"pending_count": len(items), "items": items}


async def _decide_item(
    *,
    project_id: str,
    item_id: str,
    item_type: ApprovalType,
    decision: Literal["approve", "reject"],
    reason: str | None,
    user: User,
    db: AsyncSession,
) -> dict:
    project: Project = await require_project(db, project_id, user, write=True)
    try:
        result = await decision_svc.decide(
            db,
            project=project,
            item_id=item_id,
            item_type=item_type,
            decision=decision,
            actor=user,
            reason=reason,
        )
    except ValueError as error:
        raise _decision_error(error) from error
    if result is None:
        raise HTTPException(404, detail={"code": "approval_item_not_found"})
    return {"ok": True, "decision": decision, **result}


@router.post("/{project_id}/approvals/{item_id}/approve")
async def approve_item(
    project_id: str,
    item_id: str,
    body: ApproveIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _decide_item(
        project_id=project_id,
        item_id=item_id,
        item_type=body.type,
        decision="approve",
        reason=None,
        user=user,
        db=db,
    )


@router.post("/{project_id}/approvals/{item_id}/reject")
async def reject_item(
    project_id: str,
    item_id: str,
    body: RejectIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _decide_item(
        project_id=project_id,
        item_id=item_id,
        item_type=body.type,
        decision="reject",
        reason=body.reason,
        user=user,
        db=db,
    )
