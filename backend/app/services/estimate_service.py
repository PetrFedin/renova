"""Редактор сметы и учёт расходников (план vs факт)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import EstimateLine, LineType, Project


async def recalc_budget(db: AsyncSession, project_id: str) -> float:
    """W45: делегирует в sync_project_budget_planned (estimate + approved CO)."""
    from app.services.budget_service import sync_project_budget_planned

    total = await sync_project_budget_planned(db, project_id)
    await db.commit()
    return total


async def update_line(
    db: AsyncSession,
    line_id: str,
    *,
    quantity_planned: float | None = None,
    unit_price: float | None = None,
    quantity_actual: float | None = None,
) -> EstimateLine | None:
    line = await db.get(EstimateLine, line_id)
    if not line:
        return None
    if quantity_planned is not None:
        line.quantity_planned = quantity_planned
    if unit_price is not None:
        line.unit_price = unit_price
    if quantity_actual is not None:
        line.quantity_actual = quantity_actual
    await db.commit()
    await recalc_budget(db, line.project_id)
    await db.refresh(line)
    return line


async def add_line(db: AsyncSession, project_id: str, data: dict) -> EstimateLine:
    line = EstimateLine(
        project_id=project_id,
        line_type=LineType(data["line_type"]),
        name=data["name"],
        unit=data.get("unit", "pcs"),
        quantity_planned=data["quantity_planned"],
        unit_price=data["unit_price"],
        room_name=data.get("room_name"),
    )
    db.add(line)
    await db.commit()
    await recalc_budget(db, project_id)
    await db.refresh(line)
    return line


def material_stats(lines: list[EstimateLine]) -> dict:
    materials = [l for l in lines if l.line_type == LineType.material]
    planned = sum(l.quantity_planned * l.unit_price for l in materials)
    actual = sum((l.quantity_actual or l.quantity_planned) * l.unit_price for l in materials)
    overrun = ((actual - planned) / planned * 100) if planned else 0
    return {"planned": round(planned, 2), "actual": round(actual, 2), "overrun_percent": round(overrun, 1)}


async def propose_estimate_lock(db: AsyncSession, project_id: str, *, proposed_by: str) -> tuple[Project | None, dict]:
    """W57: исполнитель предлагает фиксацию — без estimate_locked_at."""
    from datetime import datetime, timedelta
    from app.services import notification_service as notif_svc

    PROPOSE_TTL_DAYS = 14  # W66 #26

    proj = await db.get(Project, project_id)
    if not proj:
        return None, {"code": "not_found"}
    if proj.estimate_locked_at:
        return proj, {"code": "already_locked", "locked_at": proj.estimate_locked_at.isoformat()}
    result = await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))
    lines = list(result.scalars().all())
    if not lines:
        return None, {"code": "empty_estimate", "message": "Добавьте строки в смету перед фиксацией"}
    # Повторный propose всегда обновляет TTL и шлёт напоминание
    proj.estimate_lock_proposed_at = datetime.utcnow()
    proj.estimate_lock_proposed_by = proposed_by
    if proj.customer_id and proposed_by != proj.customer_id:
        await notif_svc.notify(
            db,
            user_id=proj.customer_id,
            project_id=project_id,
            notification_type="approval",
            title="Смета на согласование",
            body=f"Исполнитель отправил смету на фиксацию (действует {PROPOSE_TTL_DAYS} дн.). Проверьте и согласуйте.",
            link_path="/(customer)/(tabs)/object?tab=estimate",
            return_to="/(customer)/(tabs)/home",
        )
    await db.commit()
    await db.refresh(proj)
    return proj, {"code": "proposed", "proposed_at": proj.estimate_lock_proposed_at.isoformat()}


async def lock_estimate(db: AsyncSession, project_id: str, *, locked_by: str) -> tuple[Project | None, dict]:
    """W57: только заказчик финализирует lock (estimate_locked_at + договор)."""
    from datetime import datetime
    from app.services import project_document_service as docs_svc
    from app.services import notification_service as notif_svc

    proj = await db.get(Project, project_id)
    if not proj:
        return None, {"code": "not_found"}
    if proj.estimate_locked_at:
        return proj, {"code": "already_locked", "locked_at": proj.estimate_locked_at.isoformat()}
    result = await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))
    lines = list(result.scalars().all())
    if not lines:
        return None, {"code": "empty_estimate", "message": "Добавьте строки в смету перед фиксацией"}
    # Только customer_id может финализировать
    if locked_by != proj.customer_id:
        return proj, {"code": "customer_lock_required", "message": "Фиксацию подтверждает заказчик"}
    # W64: при назначенном исполнителе сначала propose-lock, иначе unilateral
    if proj.contractor_id and not proj.estimate_lock_proposed_at:
        return proj, {
            "code": "proposal_required",
            "message": "Сначала исполнитель должен отправить смету на согласование",
        }
    # W66 #26: просроченный propose — нужна повторная отправка
    if proj.contractor_id and proj.estimate_lock_proposed_at:
        from datetime import timedelta
        age = datetime.utcnow() - proj.estimate_lock_proposed_at
        if age > timedelta(days=14):
            return proj, {
                "code": "proposal_stale",
                "message": "Предложение сметы устарело (>14 дн.). Исполнитель должен отправить снова.",
            }
    proj.estimate_locked_at = datetime.utcnow()
    proj.estimate_lock_proposed_at = None
    proj.estimate_lock_proposed_by = None
    await recalc_budget(db, project_id)
    draft = await docs_svc.ensure_contract_draft(db, project_id=project_id, created_by=locked_by)
    titles = ", ".join(draft.get("pending_titles") or [])
    if proj.contractor_id:
        await notif_svc.notify(
            db,
            user_id=proj.contractor_id,
            project_id=project_id,
            notification_type="document",
            title="Заказчик согласовал смету",
            body=titles or "Базовая смета зафиксирована. Можно запускать этапы и договор.",
            link_path="/documents",
            return_to="/(contractor)/(tabs)/object",
        )
    await db.commit()
    await db.refresh(proj)
    return proj, {"code": "locked", "contract": draft}


async def clear_estimate_proposal(
    db: AsyncSession,
    project_id: str,
    *,
    cleared_by: str,
    reason: str | None = None,
    mode: str = "reject",
) -> tuple[Project | None, dict]:
    """W65: снять propose — reject (заказчик) или withdraw (исполнитель)."""
    from app.services import notification_service as notif_svc

    proj = await db.get(Project, project_id)
    if not proj:
        return None, {"code": "not_found"}
    if proj.estimate_locked_at:
        return proj, {"code": "already_locked", "locked_at": proj.estimate_locked_at.isoformat()}
    if not proj.estimate_lock_proposed_at:
        return proj, {"code": "no_proposal"}

    if mode == "reject":
        if cleared_by != proj.customer_id:
            return proj, {"code": "customer_reject_required", "message": "Отклонить предложение может заказчик"}
    elif mode == "withdraw":
        if cleared_by != proj.contractor_id:
            return proj, {"code": "contractor_withdraw_required", "message": "Отозвать предложение может исполнитель"}
    else:
        return proj, {"code": "invalid_mode"}

    proj.estimate_lock_proposed_at = None
    proj.estimate_lock_proposed_by = None
    body = (reason or "").strip() or (
        "Заказчик отклонил фиксацию сметы — нужна правка."
        if mode == "reject"
        else "Исполнитель отозвал предложение фиксации."
    )
    notify_uid = proj.contractor_id if mode == "reject" else proj.customer_id
    if notify_uid and notify_uid != cleared_by:
        await notif_svc.notify(
            db,
            user_id=notify_uid,
            project_id=project_id,
            notification_type="approval",
            title="Смета: предложение снято" if mode == "withdraw" else "Смета: нужна правка",
            body=body,
            link_path="/(contractor)/(tabs)/object?tab=estimate" if mode == "reject" else "/(customer)/(tabs)/object?tab=estimate",
            return_to="/(contractor)/(tabs)/home" if mode == "reject" else "/(customer)/(tabs)/home",
        )
    await db.commit()
    await db.refresh(proj)
    return proj, {"code": "cleared", "mode": mode}




