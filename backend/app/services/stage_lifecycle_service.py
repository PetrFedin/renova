"""Этап, который объекту не нужен: пропустить, вернуть, удалить.

Этап можно было создать, запустить, сдать и принять — но нельзя ни удалить,
ни пропустить. Между тем часть типового набора конкретному объекту не нужна:
если полы не трогают, «Стяжка» висит вечно на нуле и тянет прогресс вниз.

Главное действие — **пропуск**, а не удаление. На этап ссылаются двенадцать
таблиц, и удаление в общем случае означало бы потерю оплат, фото, приёмок и
расходов. Пропущенный этап остаётся в истории, перестаёт считаться в
прогрессе и возвращается обратно одним действием.

Удаление оставлено только для того случая, где оно безопасно: к этапу ничего
не привязано. Во всех остальных запрос отклоняется с перечнем того, что
именно держит этап, — чтобы человек видел причину, а не «нельзя».
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    BudgetLine,
    Expense,
    MaterialPick,
    Payment,
    ProjectIssue,
    PurchaseItem,
    Receipt,
    Stage,
    StageComment,
    StagePhoto,
    StageStatus,
    User,
    WorkAcceptance,
    WorkDependency,
    WorkOrder,
)

#: Что может держать этап. Порядок — от самого весомого для человека.
_ATTACHMENTS: list[tuple[type, str, str]] = [
    (Payment, "stage_id", "оплаты"),
    (WorkAcceptance, "stage_id", "приёмки"),
    (Expense, "stage_id", "расходы"),
    (Receipt, "stage_id", "чеки"),
    (StagePhoto, "stage_id", "фото"),
    (StageComment, "stage_id", "комментарии"),
    (ProjectIssue, "stage_id", "замечания"),
    (MaterialPick, "stage_id", "подборы материалов"),
    (PurchaseItem, "stage_id", "позиции закупок"),
    (BudgetLine, "stage_id", "строки бюджета"),
    (WorkOrder, "stage_id", "наряды"),
]


@dataclass(frozen=True)
class StageHold:
    """Что держит этап и в каком количестве."""

    label: str
    count: int


async def stage_attachments(db: AsyncSession, stage_id: str) -> list[StageHold]:
    """Всё, что ссылается на этап, с количеством."""
    holds: list[StageHold] = []
    for model, column, label in _ATTACHMENTS:
        count = await db.scalar(
            select(func.count()).select_from(model).where(getattr(model, column) == stage_id)
        )
        if count:
            holds.append(StageHold(label=label, count=int(count)))

    # Зависимости смотрят на этап с двух сторон.
    depends = await db.scalar(
        select(func.count())
        .select_from(WorkDependency)
        .where(
            (WorkDependency.stage_id == stage_id)
            | (WorkDependency.depends_on_stage_id == stage_id)
        )
    )
    if depends:
        holds.append(StageHold(label="связи между этапами", count=int(depends)))

    # И другие этапы могут зависеть от этого напрямую.
    dependants = await db.scalar(
        select(func.count()).select_from(Stage).where(Stage.depends_on_stage_id == stage_id)
    )
    if dependants:
        holds.append(StageHold(label="этапы, зависящие от этого", count=int(dependants)))

    return holds


def describe_holds(holds: list[StageHold]) -> str:
    return ", ".join(f"{hold.label} ({hold.count})" for hold in holds)


async def _stage_of_project(db: AsyncSession, project_id: str, stage_id: str) -> Stage | None:
    return await db.scalar(
        select(Stage).where(Stage.id == stage_id, Stage.project_id == project_id)
    )


async def skip_stage(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    actor: User,
    reason: str | None = None,
) -> Stage:
    """Пометить этап ненужным. Ничего не удаляется."""
    stage = await _stage_of_project(db, project_id, stage_id)
    if stage is None:
        raise ValueError("stage_not_found")
    if stage.status == StageStatus.done:
        # Сданный этап пропускать нечего — работа уже принята.
        raise ValueError("stage_already_done")
    if stage.skipped_at is not None:
        return stage

    stage.skipped_at = utc_now()
    stage.skipped_by = actor.id
    stage.skipped_reason = (reason or "").strip()[:255] or None
    # Пропущенный этап не «в работе»: иначе он остался бы в очереди дел.
    if stage.status == StageStatus.active:
        stage.status = StageStatus.planned
    await db.commit()
    await db.refresh(stage)
    return stage


async def unskip_stage(
    db: AsyncSession, *, project_id: str, stage_id: str
) -> Stage:
    """Вернуть этап в работу."""
    stage = await _stage_of_project(db, project_id, stage_id)
    if stage is None:
        raise ValueError("stage_not_found")
    if stage.skipped_at is None:
        return stage
    stage.skipped_at = None
    stage.skipped_by = None
    stage.skipped_reason = None
    await db.commit()
    await db.refresh(stage)
    return stage


async def delete_stage(
    db: AsyncSession, *, project_id: str, stage_id: str
) -> list[StageHold]:
    """Удалить этап — только если к нему ничего не привязано.

    Возвращает пустой список при успехе. Если этап что-то держит, ничего не
    удаляется и возвращается перечень: вызывающий покажет его человеку и
    предложит пропуск вместо удаления.
    """
    stage = await _stage_of_project(db, project_id, stage_id)
    if stage is None:
        raise ValueError("stage_not_found")

    holds = await stage_attachments(db, stage_id)
    if holds:
        return holds

    await db.delete(stage)
    await db.commit()
    return []
