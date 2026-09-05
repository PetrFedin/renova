"""Dependency evaluation and readiness updates.

Dependency resolution may make a stage ready to start, but it never creates
execution truth. Only stage_mutation_service.start_stage() owns planned -> active
and actual_start.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import PurchaseItem, Stage, StageStatus
from app.models.project_work_schedule import WorkDependency


@dataclass
class DependencyResult:
    can_start: bool
    blockers: list[dict]


async def evaluate_stage(db: AsyncSession, stage: Stage) -> DependencyResult:
    """Return whether all declared dependencies for *stage* are satisfied."""
    deps = list((await db.scalars(
        select(WorkDependency).where(WorkDependency.stage_id == stage.id)
    )).all())
    blockers: list[dict] = []
    for dep in deps:
        satisfied = dep.status == "satisfied"
        if dep.dependency_type == "material" and dep.material_pick_id:
            delivered = await db.scalar(
                select(PurchaseItem.id).where(
                    PurchaseItem.material_pick_id == dep.material_pick_id,
                    PurchaseItem.delivery_status == "delivered",
                )
            )
            satisfied = bool(delivered)
        elif dep.depends_on_stage_id:
            other = await db.get(Stage, dep.depends_on_stage_id)
            satisfied = bool(other and other.status == StageStatus.done)
        if not satisfied:
            blockers.append({
                "dependency_id": dep.id,
                "type": dep.dependency_type,
                "description": dep.description,
            })
    return DependencyResult(can_start=not blockers, blockers=blockers)


async def on_material_delivered(db: AsyncSession, material_pick_id: str) -> list[str]:
    """Mark matching material dependencies satisfied and return unblocked stages.

    Delivery is readiness evidence only. It must not write ``Stage.status`` or
    ``Stage.actual_start``: actor/assignee authority, contract readiness and the
    complete dependency set are enforced by the canonical explicit start
    mutation.
    """
    deps = list((await db.scalars(
        select(WorkDependency).where(
            WorkDependency.material_pick_id == material_pick_id,
            WorkDependency.status != "satisfied",
        )
    )).all())
    unlocked: list[str] = []
    for dep in deps:
        dep.status = "satisfied"
        dep.satisfied_at = date.today()
        stage = await db.get(Stage, dep.stage_id)
        if stage:
            result = await evaluate_stage(db, stage)
            if result.can_start and stage.status == StageStatus.planned:
                unlocked.append(stage.id)
    await db.flush()
    return unlocked
