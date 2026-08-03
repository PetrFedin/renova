"""Single decision dispatcher for Approval Hub and direct decision endpoints."""
from __future__ import annotations

from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User, WasteOrderStatus

ApprovalItemType = Literal[
    "material",
    "change_order",
    "room_change",
    "design",
    "waste",
]
ApprovalDecision = Literal["approve", "reject"]


async def _dispatch_prepared_effects(
    db: AsyncSession,
    *,
    source: str,
) -> None:
    from app.services.client_write_side_effects import clear_request_side_effect_context
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    clear_request_side_effect_context()
    await dispatch_best_effort(db, source=source, limit=20)


def _require_customer(project: Project, actor: User) -> None:
    if actor.id != project.customer_id:
        raise ValueError("approval_customer_required")


async def decide(
    db: AsyncSession,
    *,
    project: Project,
    item_id: str,
    item_type: ApprovalItemType,
    decision: ApprovalDecision,
    actor: User,
    reason: str | None = None,
) -> dict | None:
    """Apply one decision through the owning domain lifecycle."""
    if item_type == "material":
        _require_customer(project, actor)
        from app.services import material_pick_service as material_svc

        pick, changed, _event = await material_svc.transition_pick(
            db,
            project_id=project.id,
            pick_id=item_id,
            action=decision,
            actor_id=actor.id,
            reason=reason,
        )
        if pick is None:
            return None
        if changed:
            await _dispatch_prepared_effects(
                db,
                source=f"approval_hub.material.{decision}",
            )
        return {
            "id": pick.id,
            "type": item_type,
            "status": pick.status.value if hasattr(pick.status, "value") else str(pick.status),
            "replayed": not changed,
        }

    if item_type == "change_order":
        _require_customer(project, actor)
        from app.services import change_order_service as change_svc

        if decision == "approve":
            order, draft = await change_svc.approve_with_sign_draft(
                db,
                project_id=project.id,
                order_id=item_id,
                created_by=actor.id,
            )
            if order is None:
                return None
            replayed = bool((draft or {}).get("replayed"))
            if not replayed:
                await _dispatch_prepared_effects(
                    db,
                    source="approval_hub.change_order.approve",
                )
            return {
                "id": order.id,
                "type": item_type,
                "status": order.status.value if hasattr(order.status, "value") else str(order.status),
                "replayed": replayed,
                "document_id": (draft or {}).get("id"),
                "amount": order.amount,
                "budget_updated": True,
                "schedule_synced": bool((draft or {}).get("schedule_synced")),
            }

        order, replayed = await change_svc.reject_with_effects(
            db,
            project_id=project.id,
            order_id=item_id,
            rejected_by=actor.id,
        )
        if order is None:
            return None
        if not replayed:
            await _dispatch_prepared_effects(
                db,
                source="approval_hub.change_order.reject",
            )
        return {
            "id": order.id,
            "type": item_type,
            "status": order.status.value if hasattr(order.status, "value") else str(order.status),
            "replayed": replayed,
        }

    if item_type == "waste":
        _require_customer(project, actor)
        from app.services import waste_order_service as waste_svc

        target = (
            WasteOrderStatus.scheduled
            if decision == "approve"
            else WasteOrderStatus.cancelled
        )
        order, replayed = await waste_svc.transition_order(
            db,
            project=project,
            order_id=item_id,
            actor=actor,
            target=target,
        )
        if order is None:
            return None
        return {
            "id": order.id,
            "type": item_type,
            "status": order.status.value if hasattr(order.status, "value") else str(order.status),
            "replayed": replayed,
        }

    if item_type == "design":
        _require_customer(project, actor)
        from app.services import design_package_service as design_svc

        package, replayed = await design_svc.transition_package(
            db,
            project=project,
            package_id=item_id,
            actor=actor,
            action=decision,
            reason=reason,
        )
        if package is None:
            return None
        return {
            "id": package.id,
            "type": item_type,
            "status": str(package.status),
            "replayed": replayed,
            "version": package.version,
        }

    if item_type == "room_change":
        from app.services import room_change_service as room_change_svc

        request, room, replayed, changes = await room_change_svc.decide_request(
            db,
            project=project,
            request_id=item_id,
            actor=actor,
            decision=decision,
            reason=reason,
        )
        if request is None:
            return None
        return {
            "id": request.id,
            "type": item_type,
            "status": request.status.value if hasattr(request.status, "value") else str(request.status),
            "replayed": replayed,
            "room_id": room.id if room else request.room_id,
            "changes": changes,
        }

    raise ValueError("unknown_approval_type")
