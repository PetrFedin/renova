"""Редактор сметы и учёт расходников (план vs факт)."""
from app.core.timeutil import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import EstimateLine, LineType, Project


def serialize_estimate_lines(lines) -> list[dict]:
    """W68 #39: компактный снимок строк сметы."""
    out = []
    for line in lines:
        out.append({
            "id": line.id,
            "name": line.name,
            "line_type": line.line_type.value if hasattr(line.line_type, "value") else str(line.line_type),
            "unit": line.unit,
            "quantity_planned": float(line.quantity_planned or 0),
            "unit_price": float(line.unit_price or 0),
            "total": round(float(line.quantity_planned or 0) * float(line.unit_price or 0), 2),
        })
    return out


def diff_estimate_snapshots(baseline: list[dict], current: list[dict]) -> dict:
    """Сравнение propose-снимка с текущими строками."""
    base_map = {item["id"]: item for item in baseline}
    current_map = {item["id"]: item for item in current}
    added = [current_map[item_id] for item_id in current_map if item_id not in base_map]
    removed = [base_map[item_id] for item_id in base_map if item_id not in current_map]
    changed = []
    for item_id in current_map:
        if item_id not in base_map:
            continue
        before, after = base_map[item_id], current_map[item_id]
        fields = {}
        for key in ("name", "quantity_planned", "unit_price", "unit"):
            if before.get(key) != after.get(key):
                fields[key] = {"from": before.get(key), "to": after.get(key)}
        if fields:
            changed.append({"id": item_id, "name": after.get("name"), "fields": fields})
    baseline_total = round(sum(float(item.get("total") or 0) for item in baseline), 2)
    current_total = round(sum(float(item.get("total") or 0) for item in current), 2)
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "baseline_total": baseline_total,
        "current_total": current_total,
        "delta_total": round(current_total - baseline_total, 2),
        "has_changes": bool(added or removed or changed),
    }


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


async def prepare_line(db: AsyncSession, project_id: str, data: dict) -> EstimateLine:
    """Add and flush a complete estimate line without committing."""
    line = EstimateLine(
        project_id=project_id,
        room_id=data.get("room_id"),
        line_type=LineType(data["line_type"]),
        name=data["name"],
        unit=data.get("unit", "pcs"),
        quantity_planned=data["quantity_planned"],
        unit_price=data["unit_price"],
        room_name=data.get("room_name"),
        category=data.get("category"),
        notes=data.get("notes"),
    )
    db.add(line)
    await db.flush()
    return line


async def add_line(db: AsyncSession, project_id: str, data: dict) -> EstimateLine:
    line = await prepare_line(db, project_id, data)
    await db.commit()
    await recalc_budget(db, project_id)
    await db.refresh(line)
    return line


def material_stats(lines: list[EstimateLine]) -> dict:
    materials = [line for line in lines if line.line_type == LineType.material]
    planned = sum(line.quantity_planned * line.unit_price for line in materials)
    actual = sum((line.quantity_actual or line.quantity_planned) * line.unit_price for line in materials)
    overrun = ((actual - planned) / planned * 100) if planned else 0
    return {"planned": round(planned, 2), "actual": round(actual, 2), "overrun_percent": round(overrun, 1)}


async def get_estimate_lock_diff(db: AsyncSession, project_id: str) -> dict | None:
    """W68 #39: diff снимка propose vs текущими строками."""
    import json as _json
    project = await db.get(Project, project_id)
    if not project:
        return None
    result = await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))
    current = serialize_estimate_lines(list(result.scalars().all()))
    baseline: list[dict] = []
    if project.estimate_propose_snapshot_json:
        try:
            baseline = _json.loads(project.estimate_propose_snapshot_json)
        except Exception:
            baseline = []
    diff = diff_estimate_snapshots(baseline, current)
    return {
        "proposed_at": project.estimate_lock_proposed_at.isoformat() if project.estimate_lock_proposed_at else None,
        "locked_at": project.estimate_locked_at.isoformat() if project.estimate_locked_at else None,
        "has_baseline": bool(baseline),
        **diff,
    }


async def propose_estimate_lock(db: AsyncSession, project_id: str, *, proposed_by: str) -> tuple[Project | None, dict]:
    """W57: исполнитель отправляет фиксацию — без estimate_locked_at."""
    from datetime import timedelta
    from app.services import notification_service as notif_svc

    propose_ttl_days = 14
    project = await db.get(Project, project_id)
    if not project:
        return None, {"code": "not_found"}
    if project.estimate_locked_at:
        return project, {"code": "already_locked", "locked_at": project.estimate_locked_at.isoformat()}
    result = await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))
    lines = list(result.scalars().all())
    if not lines:
        return None, {"code": "empty_estimate", "message": "Добавьте строки в смету перед фиксацией"}
    project.estimate_lock_proposed_at = utc_now()
    project.estimate_lock_proposed_by = proposed_by
    import json as _json
    project.estimate_propose_snapshot_json = _json.dumps(serialize_estimate_lines(lines), ensure_ascii=False)
    if project.customer_id and proposed_by != project.customer_id:
        await notif_svc.notify(
            db,
            user_id=project.customer_id,
            project_id=project_id,
            notification_type="approval",
            title="Смета готова к фиксации",
            body=f"Подтвердите смету в течение {propose_ttl_days} дней",
            link_path="/(customer)/(tabs)/budget",
            return_to="/(customer)/(tabs)/home",
        )
    await db.commit()
    await db.refresh(project)
    return project, {"code": "proposed", "expires_at": (utc_now() + timedelta(days=propose_ttl_days)).isoformat()}


async def clear_estimate_proposal(
    db: AsyncSession,
    project_id: str,
    *,
    cleared_by: str,
    reason: str | None,
    mode: str,
) -> tuple[Project | None, dict]:
    project = await db.get(Project, project_id)
    if not project:
        return None, {"code": "not_found"}
    if project.estimate_locked_at:
        return project, {"code": "already_locked"}
    if not project.estimate_lock_proposed_at:
        return project, {"code": "no_proposal"}
    if mode == "reject" and project.customer_id != cleared_by:
        return project, {"code": "customer_reject_required"}
    if mode == "withdraw" and project.contractor_id != cleared_by:
        return project, {"code": "contractor_withdraw_required"}
    project.estimate_lock_proposed_at = None
    project.estimate_lock_proposed_by = None
    project.estimate_propose_snapshot_json = None
    await db.commit()
    await db.refresh(project)
    return project, {"code": "cleared", "mode": mode, "reason": reason}


async def lock_estimate(db: AsyncSession, project_id: str, *, locked_by: str) -> tuple[Project | None, dict]:
    project = await db.get(Project, project_id)
    if not project:
        return None, {"code": "not_found"}
    if project.estimate_locked_at:
        return project, {"code": "already_locked"}
    if project.customer_id != locked_by:
        return project, {"code": "customer_lock_required"}
    if not project.estimate_lock_proposed_at:
        return project, {"code": "proposal_required"}
    lines = list((await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))).scalars().all())
    if not lines:
        return None, {"code": "empty_estimate"}
    project.estimate_locked_at = utc_now()
    project.estimate_lock_proposed_at = None
    project.estimate_lock_proposed_by = None
    project.estimate_propose_snapshot_json = None
    await db.commit()
    await db.refresh(project)
    return project, {"code": "locked", "contract": None}


async def import_estimate_csv(db: AsyncSession, project_id: str, csv_text: str) -> dict:
    import csv
    import io

    reader = csv.DictReader(io.StringIO(csv_text))
    created = 0
    skipped = 0
    errors = []
    for index, row in enumerate(reader, start=2):
        try:
            name = (row.get("name") or row.get("Наименование") or "").strip()
            if not name:
                skipped += 1
                continue
            line_type = (row.get("line_type") or row.get("Тип") or "work").strip().lower()
            if line_type not in ("work", "material"):
                line_type = "work"
            quantity = float((row.get("quantity_planned") or row.get("Количество") or "1").replace(",", "."))
            price = float((row.get("unit_price") or row.get("Цена") or "0").replace(",", "."))
            await prepare_line(db, project_id, {
                "line_type": line_type,
                "name": name,
                "unit": (row.get("unit") or row.get("Ед.") or "pcs").strip(),
                "quantity_planned": quantity,
                "unit_price": price,
                "room_name": (row.get("room_name") or row.get("Комната") or "").strip() or None,
            })
            created += 1
        except Exception as exc:
            errors.append(f"Строка {index}: {exc}")
    await db.commit()
    await recalc_budget(db, project_id)
    return {"created": created, "skipped": skipped, "errors": errors}
