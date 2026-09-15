"""Reversible lifecycle and provenance for estimate lines.

A draft line is never "deleted" by setting quantity to zero and is never hard
removed when the user merely wants to undo it. The commercial line keeps the
same identity while this service controls whether it participates in active
read models and financial projections.
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import ActivityEvent, EstimateLine, Project
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
    """Use only ownership rules that already existed before provenance metadata."""
    if line.room_id is not None:
        if line.category in {"electrical", "plumbing"}:
            return SYSTEM
        if line.category == "finish" and line.name in _SYSTEM_FINISH_NAMES:
            return SYSTEM
    return MANUAL


def active_estimate_line_predicate():
    """SQL predicate: missing sidecar is treated as legacy-active, removed is not."""
    return ~exists().where(
        EstimateLineLifecycle.estimate_line_id == EstimateLine.id,
        EstimateLineLifecycle.status == REMOVED,
    )


async def lifecycle_map(
    db: AsyncSession,
    lines: Iterable[EstimateLine],
) -> dict[str, EstimateLineLifecycle]:
    materialized = list(lines)
    ids = [line.id for line in materialized if line.id]
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
    if origin is not None and row.origin != origin:
        row.origin = origin
        row.updated_at = utc_now()
        await db.flush()
    return row


async def list_removed_lines(db: AsyncSession, project_id: str) -> list[EstimateLine]:
    return list(
        (
            await db.execute(
                select(EstimateLine)
                .join(
                    EstimateLineLifecycle,
                    EstimateLineLifecycle.estimate_line_id == EstimateLine.id,
                )
                .where(
                    EstimateLine.project_id == project_id,
                    EstimateLineLifecycle.status == REMOVED,
                )
                .order_by(EstimateLine.name.asc(), EstimateLine.id.asc())
            )
        ).scalars().all()
    )


async def transition_line(
    db: AsyncSession,
    *,
    project_id: str,
    line_id: str,
    actor_id: str,
    target_status: str,
) -> tuple[EstimateLine, EstimateLineLifecycle, bool]:
    if target_status not in {ACTIVE, REMOVED}:
        raise ValueError("estimate_line_status_invalid")

    project = await db.get(Project, project_id)
    if project is None:
        raise ValueError("estimate_line_not_found")
    if project.estimate_locked_at:
        raise ValueError("estimate_locked")

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
        raise ValueError("estimate_line_not_found")

    lifecycle = await ensure_line_lifecycle(db, line)
    if lifecycle.origin == SYSTEM:
        raise ValueError("estimate_line_system_managed")

    if lifecycle.status == target_status:
        return line, lifecycle, True

    lifecycle.status = target_status
    lifecycle.updated_at = utc_now()
    if target_status == REMOVED:
        lifecycle.removed_by = actor_id
        lifecycle.removed_at = lifecycle.updated_at
        kind = "EstimateLineRemoved"
        title = f"Строка сметы убрана: {line.name}"
    else:
        lifecycle.removed_by = None
        lifecycle.removed_at = None
        kind = "EstimateLineRestored"
        title = f"Строка сметы восстановлена: {line.name}"

    db.add(
        ActivityEvent(
            project_id=project_id,
            user_id=actor_id,
            kind=kind,
            title=title,
            body=f"{line.quantity_planned:g} {line.unit} × {line.unit_price:g} ₽",
            room_id=line.room_id,
            link_path="/(customer)/(tabs)/object?tab=estimate",
        )
    )
    await db.flush()

    from app.services import budget_service as budget

    await budget.sync_project_budget_planned(db, project_id)
    await budget.sync_budget_lines_from_estimate(db, project_id)
    await budget.refresh_budget_facts(db, project_id)
    await db.commit()
    await db.refresh(line)
    await db.refresh(lifecycle)
    return line, lifecycle, False
