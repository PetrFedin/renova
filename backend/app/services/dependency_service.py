"""Dependency Engine — блокировки работ по этапам и материалам."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.workflow_templates import WORKFLOW_TEMPLATES, resolve_work_type
from app.models.entities import MaterialPick, MaterialPickStatus, Stage, StageStatus, WorkDependency


def _uuid():
    import uuid
    return str(uuid.uuid4())


async def list_dependencies(db: AsyncSession, project_id: str, stage_id: str | None = None) -> list[WorkDependency]:
    q = select(WorkDependency).where(WorkDependency.project_id == project_id)
    if stage_id:
        q = q.where(WorkDependency.stage_id == stage_id)
    r = await db.execute(q.order_by(WorkDependency.created_at.desc()))
    return list(r.scalars().all())


def dependency_dict(d: WorkDependency, *, stage_name: str | None = None, dep_stage_name: str | None = None, material_name: str | None = None) -> dict:
    return {
        "id": d.id,
        "stage_id": d.stage_id,
        "stage_name": stage_name,
        "depends_on_stage_id": d.depends_on_stage_id,
        "depends_on_stage_name": dep_stage_name,
        "depends_on_material_pick_id": d.depends_on_material_pick_id,
        "material_name": material_name,
        "dependency_type": d.dependency_type,
        "criticality": d.criticality,
        "status": d.status,
    }


async def evaluate_stage(db: AsyncSession, stage: Stage) -> dict:
    """Проверить все зависимости этапа + legacy depends_on_stage_id."""
    reasons: list[dict] = []
    blocked = False

    if stage.depends_on_stage_id:
        dep = await db.get(Stage, stage.depends_on_stage_id)
        if dep and dep.status != StageStatus.done:
            blocked = True
            reasons.append({
                "type": "work",
                "title": f"Ждёт этап: {dep.name}",
                "severity": "high",
                "ref_id": dep.id,
            })

    deps = await list_dependencies(db, stage.project_id, stage.id)
    for d in deps:
        ok = await _is_satisfied(db, d)
        d.status = "satisfied" if ok else "pending"
        if not ok:
            blocked = True
            if d.dependency_type == "work" and d.depends_on_stage_id:
                dep = await db.get(Stage, d.depends_on_stage_id)
                reasons.append({
                    "type": "work",
                    "title": f"Завершите: {dep.name if dep else 'этап'}",
                    "severity": d.criticality,
                    "ref_id": d.depends_on_stage_id,
                })
            elif d.dependency_type == "material" and d.depends_on_material_pick_id:
                pick = await db.get(MaterialPick, d.depends_on_material_pick_id)
                reasons.append({
                    "type": "material",
                    "title": f"Доставьте: {pick.name if pick else 'материал'}",
                    "severity": d.criticality,
                    "ref_id": d.depends_on_material_pick_id,
                })
    await db.commit()

    status_label = "blocked" if blocked else ("ready" if stage.status == StageStatus.planned else stage.status.value)
    if blocked and stage.status == StageStatus.planned:
        status_label = "waiting_material" if any(r["type"] == "material" for r in reasons) else "waiting_work"

    return {
        "blocked": blocked,
        "reasons": reasons,
        "status_label": status_label,
        "depends_on": reasons[0]["title"] if reasons else None,
        "can_start": not blocked and stage.status in (StageStatus.planned, StageStatus.active),
    }


async def _is_satisfied(db: AsyncSession, d: WorkDependency) -> bool:
    if d.dependency_type == "work" and d.depends_on_stage_id:
        dep = await db.get(Stage, d.depends_on_stage_id)
        return bool(dep and dep.status == StageStatus.done)
    if d.dependency_type == "material" and d.depends_on_material_pick_id:
        pick = await db.get(MaterialPick, d.depends_on_material_pick_id)
        return bool(pick and pick.status == MaterialPickStatus.purchased)
    return True


async def sync_from_workflow(db: AsyncSession, project_id: str) -> int:
    """Создать зависимости из шаблонов workflow по work_type этапов."""
    r = await db.execute(select(Stage).where(Stage.project_id == project_id))
    stages = list(r.scalars().all())
    by_type: dict[str, Stage] = {}
    for s in stages:
        wt = resolve_work_type(s.work_type, s.name)
        if wt not in by_type or s.sort_order < by_type[wt].sort_order:
            by_type[wt] = s

    created = 0
    for s in stages:
        wt = resolve_work_type(s.work_type, s.name)
        tpl = WORKFLOW_TEMPLATES.get(wt, {})
        for dep_type in tpl.get("depends_on", []):
            pred = by_type.get(dep_type)
            if not pred or pred.id == s.id:
                continue
            ex = await db.execute(
                select(WorkDependency).where(
                    WorkDependency.stage_id == s.id,
                    WorkDependency.depends_on_stage_id == pred.id,
                )
            )
            if ex.scalar_one_or_none():
                continue
            db.add(
                WorkDependency(
                    id=_uuid(),
                    project_id=project_id,
                    stage_id=s.id,
                    depends_on_stage_id=pred.id,
                    dependency_type="work",
                    criticality="high",
                )
            )
            created += 1
            if not s.depends_on_stage_id:
                s.depends_on_stage_id = pred.id

        # материалы этапа
        picks_r = await db.execute(
            select(MaterialPick).where(MaterialPick.project_id == project_id, MaterialPick.stage_id == s.id)
        )
        for pick in picks_r.scalars().all():
            ex = await db.execute(
                select(WorkDependency).where(
                    WorkDependency.stage_id == s.id,
                    WorkDependency.depends_on_material_pick_id == pick.id,
                )
            )
            if ex.scalar_one_or_none():
                continue
            db.add(
                WorkDependency(
                    id=_uuid(),
                    project_id=project_id,
                    stage_id=s.id,
                    depends_on_material_pick_id=pick.id,
                    dependency_type="material",
                    criticality="high",
                )
            )
            created += 1

    await db.commit()
    return created


async def on_material_delivered(db: AsyncSession, material_pick_id: str) -> list[str]:
    """Разблокировать работы после доставки материала."""
    r = await db.execute(
        select(WorkDependency).where(
            WorkDependency.depends_on_material_pick_id == material_pick_id,
            WorkDependency.dependency_type == "material",
        )
    )
    unlocked: list[str] = []
    for d in r.scalars().all():
        d.status = "satisfied"
        stage = await db.get(Stage, d.stage_id)
        if stage and stage.status == StageStatus.planned:
            ev = await evaluate_stage(db, stage)
            if not ev["blocked"]:
                stage.status = StageStatus.active
                unlocked.append(stage.id)
    await db.commit()
    return unlocked
