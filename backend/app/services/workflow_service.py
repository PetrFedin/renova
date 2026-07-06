"""Workflow Engine — шаблоны процессов и чеклисты этапов."""
from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.data.workflow_templates import get_template, checklist_for_phase
from app.models.entities import Stage


def _parse_checklist(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def checklist_from_template(work_type: str | None, stage_name: str | None) -> list[dict]:
    return checklist_for_phase(stage_name, work_type)


def stage_checklist(stage: Stage) -> list[dict]:
    items = _parse_checklist(getattr(stage, "checklist_json", None))
    if items:
        return items
    return checklist_from_template(stage.work_type, stage.name)


def checklist_progress(items: list[dict]) -> float:
    if not items:
        return 0.0
    done = sum(1 for i in items if i.get("done"))
    return round(done / len(items) * 100, 1)


async def ensure_stage_checklist(db: AsyncSession, stage: Stage) -> list[dict]:
    if getattr(stage, "checklist_json", None):
        return stage_checklist(stage)
    items = checklist_from_template(stage.work_type, stage.name)
    stage.checklist_json = json.dumps(items, ensure_ascii=False)
    await db.commit()
    await db.refresh(stage)
    return items


async def toggle_checklist_item(db: AsyncSession, stage: Stage, item_id: str, done: bool) -> list[dict]:
    items = await ensure_stage_checklist(db, stage)
    for it in items:
        if it.get("id") == item_id:
            it["done"] = done
            break
    stage.checklist_json = json.dumps(items, ensure_ascii=False)
    total = checklist_progress(items)
    if total > stage.percent_complete:
        stage.percent_complete = total
    await db.commit()
    await db.refresh(stage)
    return items


def workflow_dict(stage: Stage) -> dict:
    tpl = get_template(stage.work_type, stage.name)
    items = stage_checklist(stage)
    return {
        "work_type": tpl["work_type"],
        "name": tpl["name"],
        "steps": tpl.get("steps", []),
        "checklist": items,
        "checklist_progress": checklist_progress(items),
        "depends_on": tpl.get("depends_on", []),
    }
