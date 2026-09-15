"""Reversible lifecycle and provenance for estimate lines.

Active estimate rows stay in the legacy ``estimate_lines`` table so every
existing calculation/export naturally sees only active commercial truth. A
user remove first writes a lossless tombstone, then removes the active row in
the same transaction. Restore recreates the same line id from that tombstone.
"""
from __future__ import annotations

from collections.abc import Iterable
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import ActivityEvent, BudgetLine, EstimateLine, LineType, Project
from app.models.estimate_line_lifecycle import EstimateLineLifecycle

ACTIVE = "active"
REMOVED = "removed"
SYSTEM = "system"
MANUAL = "manual"
IMPORTED = "import"

_SYSTEM_FINISH_NAMES = frozenset(
    {
        "Фартук плитка",
        "Напольное покрытие",
        "Электромонтаж кухни",
        "Плитка фартук",
        "Ламинат/кварц-винил",
        "Демонтаж покрытий",
        "Штукатурка стен",
        "Штукатурная смесь",
        "Гидроизоляция",
        "Укладка плитки",
        "Керамогранит",
        "Гидроизоляция Ceresit",
        "Подготовка стен",
        "Покраска стен 2 слоя",
        "Укладка ламината",
        "Краска интерьерная",
        "Ламинат",
    }
)


def infer_legacy_origin(line: EstimateLine) -> str:
    """Use only ownership rules that existed before provenance metadata."""
    if line.room_id is not None:
        if line.category in {"electrical", "plumbing"}:
            return SYSTEM
        if line.category == "finish" and line.name in _SYSTEM_FINISH_NAMES:
            return SYSTEM
    return MANUAL


def _line_type_value(line: EstimateLine) -> str:
    return line.line_type.value if hasattr(line.line_type, "value") else str(line.line_type)


def snapshot_line(line: EstimateLine) -> dict[str, object]:
    return {
        "id": line.id,
        "project_id": line.project_id,
        "room_id": line.room_id,
        "line_type": _line_type_value(line),
        "name": line.name,
        "unit": line.unit,
        "quantity_planned": float(line.quantity_planned or 0),
        "quantity_actual": float(line.quantity_actual or 0),
        "unit_price": float(line.unit_price or 0),
        "room_name": line.room_name,
        "category": line.category,
        "calc_detail": line.calc_detail,
        "notes": line.notes,
    }


def serialize_line(line: EstimateLine, *, origin: str, status: str = ACTIVE) -> dict[str, object]:
    snap = snapshot_line(line)
    snap.update(
        {
            "origin": origin,
            "lifecycle_status": status,
            "total": round(float(line.quantity_planned or 0) * float(line.unit_price or 0), 2),
        }
    )
    return snap


def _decode_snapshot(row: EstimateLineLifecycle) -> dict[str, object]:
    if not row.snapshot_json:
        raise RuntimeError("estimate_line_tombstone_missing")
    try:
        payload = json.loads(row.snapshot_json)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("estimate_line_tombstone_invalid") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("estimate_line_tombstone_invalid")
    if payload.get("id") != row.estimate_line_id or payload.get("project_id") != row.project_id:
        raise RuntimeError("estimate_line_tombstone_identity_mismatch")
    return payload


def serialize_tombstone(row: EstimateLineLifecycle) -> dict[str, object]:
    payload = _decode_snapshot(row)
    payload.update(
        {
            "origin": row.origin,
            "lifecycle_status": row.status,
            "removed_at": row.removed_at.isoformat() if row.removed_at else None,
            "removed_by": row.removed_by,
            "total": round(
                float(payload.get("quantity_planned") or 0)
                * float(payload.get("unit_price") or 0),
                2,
            ),
        }
    )
    return payload


async def lifecycle_map(
    db: AsyncSession,
    lines: Iterable[EstimateLine],
) -> dict[str, EstimateLineLifecycle]:
    ids = [line.id for line in lines if line.id]
    if not ids:
        return {}
    rows = list(
        (
            await db.execute(
                select(EstimateLineLifecycle).where(
                    EstimateLineLifecycle.estimate_line_id.in_(ids)
                )
            )
        ).scalars().all()
    )
    return {row.estimate_line_id: row for row in rows}


async def ensure_line_lifecycle(
    db: AsyncSession,
    line: EstimateLine,
    *,
    origin: str | None = None,
) -> EstimateLineLifecycle:
    if not line.id:
        await db.flush()
    row = await db.get(EstimateLineLifecycle, line.id)
    resolved_origin = origin or infer_legacy_origin(line)
    if row is None:
        row = EstimateLineLifecycle(
            estimate_line_id=line.id,
            project_id=line.project_id,
            origin=resolved_origin,
            status=ACTIVE,
        )
        db.add(row)
        await db.flush()
        return row
    if row.project_id != line.project_id:
        raise RuntimeError("estimate_line_lifecycle_project_mismatch")
    if row.status != ACTIVE:
        raise RuntimeError("estimate_line_active_tombstone_conflict")
    if origin is not None and row.origin != origin:
        row.origin = origin
        row.updated_at = utc_now()
        await db.flush()
    return row


async def lifecycle_view(db: AsyncSession, project_id: str) -> dict[str, list[dict[str, object]]]:
    active_lines = list(
        (
            await db.execute(
                select(EstimateLine)
                .where(EstimateLine.project_id == project_id)
                .order_by(EstimateLine.name.asc(), EstimateLine.id.asc())
            )
        ).scalars().all()
    )
    states = await lifecycle_map(db, active_lines)
    active = []
    for line in active_lines:
        row = states.get(line.id)
        origin = row.origin if row else infer_legacy_origin(line)
        active.append(serialize_line(line, origin=origin))

    removed_rows = list(
        (
            await db.execute(
                select(EstimateLineLifecycle)
                .where(
                    EstimateLineLifecycle.project_id == project_id,
                    EstimateLineLifecycle.status == REMOVED,
                )
                .order_by(EstimateLineLifecycle.removed_at.desc())
            )
        ).scalars().all()
    )
    return {
        "active": active,
        "removed": [serialize_tombstone(row) for row in removed_rows],
    }


async def _recompute_financial_truth(db: AsyncSession, project_id: str) -> None:
    from app.services import budget_service as budget

    await budget.sync_project_budget_planned(db, project_id)
    await budget.sync_budget_lines_from_estimate(db, project_id)
    await budget.refresh_budget_facts(db, project_id)


def _transition_error_for_system() -> ValueError:
    return ValueError("estimate_line_system_managed")


async def remove_line(
    db: AsyncSession,
    *,
    project_id: str,
    line_id: str,
    actor_id: str,
) -> tuple[dict[str, object], bool]:
    project = await db.get(Project, project_id)
    if project is None:
        raise ValueError("estimate_line_not_found")
    if project.estimate_locked_at:
        raise ValueError("estimate_locked")

    lifecycle = await db.get(EstimateLineLifecycle, line_id)
    if lifecycle is not None and lifecycle.project_id != project_id:
        raise ValueError("estimate_line_not_found")

    query = select(EstimateLine).where(
        EstimateLine.id == line_id,
        EstimateLine.project_id == project_id,
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    line = (await db.execute(query)).scalar_one_or_none()

    if line is None:
        if lifecycle is not None and lifecycle.status == REMOVED:
            return serialize_tombstone(lifecycle), True
        raise ValueError("estimate_line_not_found")

    lifecycle = await ensure_line_lifecycle(db, line)
    if lifecycle.origin == SYSTEM:
        raise _transition_error_for_system()

    payload = snapshot_line(line)
    now = utc_now()
    lifecycle.status = REMOVED
    lifecycle.snapshot_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    lifecycle.removed_by = actor_id
    lifecycle.removed_at = now
    lifecycle.updated_at = now

    budget_rows = list(
        (
            await db.execute(
                select(BudgetLine).where(BudgetLine.estimate_line_id == line.id)
            )
        ).scalars().all()
    )
    for budget_line in budget_rows:
        await db.delete(budget_line)
    await db.delete(line)

    db.add(
        ActivityEvent(
            project_id=project_id,
            user_id=actor_id,
            kind="EstimateLineRemoved",
            title=f"Строка сметы убрана: {payload['name']}",
            body=f"{payload['quantity_planned']} {payload['unit']} × {payload['unit_price']} ₽",
            room_id=payload.get("room_id"),
            link_path="/(customer)/(tabs)/object?tab=estimate",
        )
    )
    await db.flush()
    await _recompute_financial_truth(db, project_id)
    await db.commit()
    await db.refresh(lifecycle)
    return serialize_tombstone(lifecycle), False


async def restore_line(
    db: AsyncSession,
    *,
    project_id: str,
    line_id: str,
    actor_id: str,
) -> tuple[dict[str, object], bool]:
    project = await db.get(Project, project_id)
    if project is None:
        raise ValueError("estimate_line_not_found")
    if project.estimate_locked_at:
        raise ValueError("estimate_locked")

    lifecycle = await db.get(EstimateLineLifecycle, line_id)
    if lifecycle is None or lifecycle.project_id != project_id:
        raise ValueError("estimate_line_not_found")
    if lifecycle.origin == SYSTEM:
        raise _transition_error_for_system()

    existing = await db.get(EstimateLine, line_id)
    if lifecycle.status == ACTIVE:
        if existing is None:
            raise RuntimeError("estimate_line_active_missing")
        return serialize_line(existing, origin=lifecycle.origin), True
    if existing is not None:
        raise RuntimeError("estimate_line_removed_row_present")

    payload = _decode_snapshot(lifecycle)
    try:
        line_type = LineType(str(payload["line_type"]))
        name = str(payload["name"])
        unit = str(payload["unit"])
        quantity_planned = float(payload["quantity_planned"])
        quantity_actual = float(payload.get("quantity_actual") or 0)
        unit_price = float(payload["unit_price"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError("estimate_line_tombstone_invalid") from exc

    line = EstimateLine(
        id=line_id,
        project_id=project_id,
        room_id=payload.get("room_id"),
        line_type=line_type,
        name=name,
        unit=unit,
        quantity_planned=quantity_planned,
        quantity_actual=quantity_actual,
        unit_price=unit_price,
        room_name=payload.get("room_name"),
        category=payload.get("category"),
        calc_detail=payload.get("calc_detail"),
        notes=payload.get("notes"),
    )
    db.add(line)
    now = utc_now()
    lifecycle.status = ACTIVE
    lifecycle.removed_by = None
    lifecycle.removed_at = None
    lifecycle.updated_at = now

    db.add(
        ActivityEvent(
            project_id=project_id,
            user_id=actor_id,
            kind="EstimateLineRestored",
            title=f"Строка сметы восстановлена: {name}",
            body=f"{quantity_planned:g} {unit} × {unit_price:g} ₽",
            room_id=payload.get("room_id"),
            link_path="/(customer)/(tabs)/object?tab=estimate",
        )
    )
    await db.flush()
    await _recompute_financial_truth(db, project_id)
    await db.commit()
    await db.refresh(line)
    await db.refresh(lifecycle)
    return serialize_line(line, origin=lifecycle.origin), False
