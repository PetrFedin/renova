from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import ChangeOrder, User, UserRole
from app.services import change_order_service as co_svc
from app.services import activity_service as act
from app.services import notification_service as notif

router = APIRouter(prefix="/projects/{project_id}/change-orders", tags=["change-orders"])
CHANGE_ORDER_CREATE_SCOPE = "change_order.create"


class ChangeOrderCreate(BaseModel):
    title: str
    amount: float = Field(gt=0)
    description: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


def _member_ids(project) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for uid in [project.customer_id, project.contractor_id, project.foreman_id]:
        if uid and uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out


@router.get("")
async def list_co(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    items = await co_svc.list_orders(db, project_id)
    return [{"id": x.id, "title": x.title, "amount": x.amount, "status": x.status.value, "description": x.description} for x in items]


@router.post("")
async def create_co(project_id: str, body: ChangeOrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.contractor:
        raise HTTPException(403)

    from app.services.change_order_create_service import prepare_order
    from app.services.client_write_idempotency import (
        IdempotencyConflict,
        commit_client_write,
        replay_entity_id,
    )

    payload = {
        "title": body.title,
        "amount": float(body.amount),
        "description": body.description,
    }
    try:
        replay_id = await replay_entity_id(
            db,
            scope=CHANGE_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as error:
        raise HTTPException(
            409,
            detail={
                "code": "idempotency_conflict",
                "message": "Этот идентификатор запроса уже использован для других доп. работ",
            },
        ) from error

    if replay_id:
        existing = await db.get(ChangeOrder, replay_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_entity_missing"})
        return {"id": existing.id, "status": existing.status.value, "replayed": True}

    order = await prepare_order(
        db,
        project_id=project_id,
        user_id=user.id,
        title=body.title,
        amount=body.amount,
        description=body.description,
    )
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=CHANGE_ORDER_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=order.id,
        )
    except IdempotencyConflict as error:
        raise HTTPException(
            409,
            detail={
                "code": "idempotency_conflict",
                "message": "Этот идентификатор запроса уже использован для других доп. работ",
            },
        ) from error

    if not created:
        existing = await db.get(ChangeOrder, entity_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_entity_missing"})
        return {"id": existing.id, "status": existing.status.value, "replayed": True}

    from app.services.client_write_side_effects import clear_request_side_effect_context

    try:
        await act.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="ChangeOrderCreated",
            title=f"Доп. работы: {order.title}",
            body=body.description,
            link_path="/(customer)/(tabs)/object?tab=estimate&estimateLayer=changes",
        )
        if project.customer_id:
            await notif.notify(
                db,
                user_id=project.customer_id,
                project_id=project_id,
                notification_type="change_order",
                title=f"Согласуйте доп. работы: {order.title}",
                body=f"{order.amount:.0f} ₽ · смета → Доп. работы",
                link_path="/(customer)/(tabs)/object?tab=estimate&estimateLayer=changes",
                return_to="/(customer)/(tabs)/",
            )
    finally:
        clear_request_side_effect_context()
    return {"id": order.id, "status": order.status.value, "replayed": False}


@router.post("/{order_id}/approve")
async def approve_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    co, draft_meta = await co_svc.approve_with_sign_draft(
        db,
        project_id=project_id,
        order_id=order_id,
        created_by=user.id,
    )
    if not co:
        raise HTTPException(404)

    draft_id = (draft_meta or {}).get("id")
    replayed = bool((draft_meta or {}).get("replayed"))
    if not replayed:
        from app.services.client_write_side_effects import clear_request_side_effect_context

        try:
            await act.log_event(
                db,
                project_id=project_id,
                user_id=user.id,
                kind="DocumentDraftForSign",
                title=f"Подпишите доп. работы: {co.title}",
                body=f"Документ {draft_id} · {co.amount:.0f} ₽",
                link_path="/documents",
            )
            await act.log_event(
                db,
                project_id=project_id,
                user_id=user.id,
                kind="ChangeOrderApproved",
                title=f"Доп. работы согласованы: {co.title}",
                body=str(co.amount),
                link_path="/(customer)/(tabs)/budget",
            )
            for member_id in _member_ids(project):
                if member_id == user.id:
                    continue
                await notif.notify(
                    db,
                    user_id=member_id,
                    project_id=project_id,
                    notification_type="change_order",
                    title=f"Доп. работы согласованы: {co.title}",
                    body=str(co.amount),
                    link_path="/(contractor)/(tabs)/budget",
                    return_to="/(contractor)/(tabs)/home",
                )
            if project.customer_id:
                await notif.notify(
                    db,
                    user_id=project.customer_id,
                    project_id=project_id,
                    notification_type="document",
                    title=f"Подпишите доп. работы: {co.title}",
                    body=f"Черновик в Документах · {co.amount:.0f} ₽",
                    link_path="/documents",
                    return_to="/(customer)/(tabs)/",
                )
        finally:
            clear_request_side_effect_context()

    return {
        "ok": True,
        "status": co.status.value,
        "document_id": draft_id,
        "amount": co.amount,
        "title": co.title,
        "schedule_synced": bool((draft_meta or {}).get("schedule_synced")),
        "replayed": replayed,
    }


@router.post("/{order_id}/reject")
async def reject_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    co, replayed = await co_svc.reject_with_effects(
        db,
        project_id=project_id,
        order_id=order_id,
        rejected_by=user.id,
    )
    if not co:
        raise HTTPException(404)

    if not replayed:
        from app.services.client_write_side_effects import clear_request_side_effect_context

        try:
            await act.log_event(
                db,
                project_id=project_id,
                user_id=user.id,
                kind="ChangeOrderRejected",
                title=f"Доп. работы отклонены: {co.title}",
                body=co.description,
                link_path="/(customer)/(tabs)/budget",
            )
            for member_id in _member_ids(project):
                if member_id == user.id:
                    continue
                await notif.notify(
                    db,
                    user_id=member_id,
                    project_id=project_id,
                    notification_type="change_order",
                    title=f"Доп. работы отклонены: {co.title}",
                    body=co.description or "",
                    link_path="/(contractor)/(tabs)/budget",
                    return_to="/(contractor)/(tabs)/home",
                )
        finally:
            clear_request_side_effect_context()

    return {"ok": True, "status": co.status.value, "replayed": replayed}
