"""Dependency Engine — блокировки работ по этапам и материалам."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.workflow_templates import WORKFLOW_TEMPLATES, resolve_work_type
from app.models.entities import MaterialPick, Stage, StageStatus, WorkDependency
from app.services import material_supply_service


def _uuid():
    import uuid

    return str(uuid.uuid4())


async def list_dependencies(
    db: AsyncSession,
    project_id: str,
    stage_id: str | None = None,
) -> list[WorkDependency]:
    query = select(WorkDependency).where(WorkDependency.project_id == project_id)
    if stage_id:
        query = query.where(WorkDependency.stage_id == stage_id)
    result = await db.execute(query.order_by(WorkDependency.created_at.desc()))
    return list(result.scalars().all())


def dependency_dict(
    dependency: WorkDependency,
    *,
    stage_name: str | None = None,
    dep_stage_name: str | None = None,
    material_name: str | None = None,
) -> dict:
    return {
        "id": dependency.id,
        "stage_id": dependency.stage_id,
        "stage_name": stage_name,
        "depends_on_stage_id": dependency.depends_on_stage_id,
        "depends_on_stage_name": dep_stage_name,
        "depends_on_material_pick_id": dependency.depends_on_material_pick_id,
        "material_name": material_name,
        "dependency_type": dependency.dependency_type,
        "criticality": dependency.criticality,
        "status": dependency.status,
    }


async def evaluate_stage(
    db: AsyncSession,
    stage: Stage,
    *,
    commit: bool = True,
    persist_status: bool = True,
) -> dict:
    """Проверить зависимости этапа без скрытой записи из read-only вызовов.

    ``persist_status=False`` используется в GET/read-model путях: вычисление остаётся
    чистым и не выполняет flush/commit. Mutation lifecycles могут передать
    ``commit=False`` и включить обновление dependency status в свою транзакцию.
    """
    reasons: list[dict] = []
    blocked = False

    if stage.depends_on_stage_id:
        predecessor = await db.get(Stage, stage.depends_on_stage_id)
        if predecessor and predecessor.status != StageStatus.done:
            blocked = True
            reasons.append(
                {
                    "type": "work",
                    "title": f"Ждёт этап: {predecessor.name}",
                    "severity": "high",
                    "ref_id": predecessor.id,
                }
            )

    dependencies = await list_dependencies(db, stage.project_id, stage.id)
    for dependency in dependencies:
        satisfied = await _is_satisfied(db, dependency)
        if persist_status:
            dependency.status = "satisfied" if satisfied else "pending"
        if satisfied:
            continue
        blocked = True
        if dependency.dependency_type == "work" and dependency.depends_on_stage_id:
            predecessor = await db.get(Stage, dependency.depends_on_stage_id)
            reasons.append(
                {
                    "type": "work",
                    "title": f"Завершите: {predecessor.name if predecessor else 'этап'}",
                    "severity": dependency.criticality,
                    "ref_id": dependency.depends_on_stage_id,
                }
            )
        elif dependency.dependency_type == "material" and dependency.depends_on_material_pick_id:
            pick = await db.get(MaterialPick, dependency.depends_on_material_pick_id)
            reasons.append(
                {
                    "type": "material",
                    "title": f"Доставьте: {pick.name if pick else 'материал'}",
                    "severity": dependency.criticality,
                    "ref_id": dependency.depends_on_material_pick_id,
                }
            )

    if persist_status:
        if commit:
            await db.commit()
        else:
            await db.flush()

    status_label = (
        "blocked"
        if blocked
        else ("ready" if stage.status == StageStatus.planned else stage.status.value)
    )
    if blocked and stage.status == StageStatus.planned:
        status_label = (
            "waiting_material"
            if any(reason["type"] == "material" for reason in reasons)
            else "waiting_work"
        )

    return {
        "blocked": blocked,
        "reasons": reasons,
        "status_label": status_label,
        "depends_on": reasons[0]["title"] if reasons else None,
        "can_start": not blocked and stage.status in (StageStatus.planned, StageStatus.active),
    }


async def _is_satisfied(db: AsyncSession, dependency: WorkDependency) -> bool:
    if dependency.dependency_type == "work" and dependency.depends_on_stage_id:
        predecessor = await db.get(Stage, dependency.depends_on_stage_id)
        return bool(predecessor and predecessor.status == StageStatus.done)
    if dependency.dependency_type == "material" and dependency.depends_on_material_pick_id:
        pick = await db.get(MaterialPick, dependency.depends_on_material_pick_id)
        return bool(pick and material_supply_service.snapshot(pick).is_available)
    return True


async def sync_from_workflow(
    db: AsyncSession,
    project_id: str,
    *,
    commit: bool = True,
) -> int:
    """Создать зависимости из шаблонов workflow, optionally in caller transaction."""
    result = await db.execute(select(Stage).where(Stage.project_id == project_id))
    stages = list(result.scalars().all())
    by_type: dict[str, Stage] = {}
    for stage in stages:
        work_type = resolve_work_type(stage.work_type, stage.name)
        if work_type not in by_type or stage.sort_order < by_type[work_type].sort_order:
            by_type[work_type] = stage

    created = 0
    for stage in stages:
        work_type = resolve_work_type(stage.work_type, stage.name)
        template = WORKFLOW_TEMPLATES.get(work_type, {})
        for dependency_type in template.get("depends_on", []):
            predecessor = by_type.get(dependency_type)
            if not predecessor or predecessor.id == stage.id:
                continue
            existing = await db.execute(
                select(WorkDependency).where(
                    WorkDependency.stage_id == stage.id,
                    WorkDependency.depends_on_stage_id == predecessor.id,
                )
            )
            if existing.scalar_one_or_none():
                continue
            db.add(
                WorkDependency(
                    id=_uuid(),
                    project_id=project_id,
                    stage_id=stage.id,
                    depends_on_stage_id=predecessor.id,
                    dependency_type="work",
                    criticality="high",
                )
            )
            created += 1
            if not stage.depends_on_stage_id:
                stage.depends_on_stage_id = predecessor.id

        picks_result = await db.execute(
            select(MaterialPick).where(
                MaterialPick.project_id == project_id,
                MaterialPick.stage_id == stage.id,
            )
        )
        for pick in picks_result.scalars().all():
            existing = await db.execute(
                select(WorkDependency).where(
                    WorkDependency.stage_id == stage.id,
                    WorkDependency.depends_on_material_pick_id == pick.id,
                )
            )
            if existing.scalar_one_or_none():
                continue
            db.add(
                WorkDependency(
                    id=_uuid(),
                    project_id=project_id,
                    stage_id=stage.id,
                    depends_on_material_pick_id=pick.id,
                    dependency_type="material",
                    criticality="high",
                )
            )
            created += 1

    if commit:
        await db.commit()
    else:
        await db.flush()
    return created


async def on_material_delivered(
    db: AsyncSession,
    material_pick_id: str,
    *,
    commit: bool = True,
) -> list[str]:
    """Recompute dependency truth after material availability changes.

    Supply/delivery may make a stage ready for an explicit canonical start, but
    never creates execution truth. Partial delivery remains blocking until the
    combined available + delivered quantity covers the required quantity.
    """
    result = await db.execute(
        select(WorkDependency).where(
            WorkDependency.depends_on_material_pick_id == material_pick_id,
            WorkDependency.dependency_type == "material",
        )
    )
    unlocked: list[str] = []
    for dependency in result.scalars().all():
        satisfied = await _is_satisfied(db, dependency)
        dependency.status = "satisfied" if satisfied else "pending"
        stage = await db.get(Stage, dependency.stage_id)
        if stage and stage.status == StageStatus.planned:
            evaluation = await evaluate_stage(
                db,
                stage,
                commit=False,
                persist_status=True,
            )
            if not evaluation["blocked"]:
                unlocked.append(stage.id)
    if commit:
        await db.commit()
    else:
        await db.flush()
    return unlocked
