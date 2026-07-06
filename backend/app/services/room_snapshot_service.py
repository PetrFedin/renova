"""Digital Twin комнаты — паспорт: размеры, работы, материалы, расходы, дефекты."""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, MaterialPick, ProjectIssue, Room, Stage, StageStatus
from app.services.stage_service import parse_room_ids
from app.services import room_service as room_svc
from app.services import stage_status_service as st_status
from app.services import dependency_service as dep_svc


def _stages_for_room(project, room_id: str) -> list[Stage]:
    out: list[Stage] = []
    for s in project.stages or []:
        rids = parse_room_ids(s)
        if room_id in rids:
            out.append(s)
    return sorted(out, key=lambda x: x.sort_order)




async def _stage_card(db, stage: Stage, project, *, role: str = "customer") -> dict:
    """§4.4 Карточка этапа для vertical timeline."""
    blocked = await dep_svc.evaluate_stage(db, stage)
    picks = (await db.execute(select(MaterialPick).where(MaterialPick.stage_id == stage.id))).scalars().all()
    waiting_materials = any(getattr(p.status, "value", p.status) in ("draft", "pending", "ordered") for p in picks)
    works_total, works_done = st_status.works_counts(stage)
    disp = st_status.compute_display_status(stage, blocked=blocked.get("blocked", False), waiting_materials=waiting_materials)
    from app.services import work_snapshot_service as ws
    comp = await ws.completion_check(db, stage, project)
    na = ws.next_action(stage, role, completion_ok=comp["ok"])
    return {
        "id": stage.id,
        "name": stage.name,
        "sort_order": stage.sort_order,
        "status": stage.status.value,
        "display_status": disp,
        "display_status_label": st_status.display_status_label(disp),
        "works_total": works_total,
        "works_done": works_done,
        "percent_complete": stage.percent_complete,
        "planned_start": stage.planned_start.isoformat() if stage.planned_start else None,
        "planned_end": stage.planned_end.isoformat() if stage.planned_end else None,
        "actual_start": stage.actual_start.isoformat() if getattr(stage, "actual_start", None) else None,
        "actual_end": stage.actual_end.isoformat() if getattr(stage, "actual_end", None) else None,
        "assignee_id": getattr(stage, "assignee_id", None),
        "overdue_days": st_status.delay_days(stage),
        "blocked": blocked.get("blocked", False),
        "next_action": na,
        "is_current": stage.status.value == "active",
        "is_future": stage.status.value == "planned",
        "is_done": stage.status.value == "done",
    }


async def build_room_snapshot(db: AsyncSession, project, room: Room) -> dict:
    """Снимок комнаты для паспорта и UI."""
    stages = _stages_for_room(project, room.id)
    if not stages:
        # fallback: старые проекты без room_ids на этапах — показываем весь путь
        stages = sorted(project.stages or [], key=lambda x: x.sort_order)
    active = next((s for s in stages if s.status == StageStatus.active), None)
    review = next((s for s in stages if s.status == StageStatus.review), None)
    done = [s for s in stages if s.status == StageStatus.done]
    progress = st_status.weighted_progress(stages) if stages else 0

    picks = (await db.execute(select(MaterialPick).where(MaterialPick.room_id == room.id))).scalars().all()
    need_buy = [p for p in picks if getattr(p.status, "value", p.status) in ("draft", "pending")]
    delivered = [p for p in picks if getattr(p.status, "value", p.status) == "purchased"]

    expenses = (await db.execute(select(Expense).where(Expense.room_id == room.id, Expense.status == "confirmed"))).scalars().all()
    spent = sum(e.amount or 0 for e in expenses)

    lines = [l for l in (project.estimate_lines or []) if l.room_id == room.id or l.room_name == room.name]
    planned = sum((l.quantity_planned or 0) * (l.unit_price or 0) for l in lines)

    issues = (await db.execute(select(ProjectIssue).where(ProjectIssue.room_id == room.id))).scalars().all()
    open_issues = [i for i in issues if i.status != "closed"]

    # Next action для комнаты
    na = {"title": "Комната в плане", "button": "Открыть работы", "kind": "work", "href": f"/room/{room.id}"}
    if review:
        na = {"title": f"Принять: {review.name}", "button": "На приёмку", "kind": "accept", "href": f"/stage/{review.id}"}
    elif active:
        na = {"title": f"В работе: {active.name}", "button": "Открыть", "kind": "work", "href": f"/stage/{active.id}"}
    elif need_buy:
        na = {"title": f"Закупить материалы ({len(need_buy)})", "button": "Материалы", "kind": "material", "href": "/(customer)/(tabs)/materials"}
    elif not stages:
        na = {"title": "Рассчитать материалы", "button": "Калькулятор", "kind": "calc", "href": f"/room/{room.id}"}

    detail = room_svc.room_detail(room)

    stage_cards = []
    for s in stages:
        stage_cards.append(await _stage_card(db, s, project))

    return {
        "id": room.id,
        "name": room.name,
        "room_type": room.room_type,
        "floor_level": getattr(room, "floor_level", 1),
        "metrics": {
            "floor_sq_m": detail["floor_sq_m"],
            "wall_sq_m": detail["wall_sq_m"],
            "perimeter_m": detail["perimeter_m"],
            "height_m": room.height_m,
        },
        "budget": {
            "planned": round(planned, 2),
            "spent": round(spent, 2),
            "remaining": round(max(0, planned - spent), 2),
            "overrun": round(max(0, spent - planned), 2) if planned else 0,
        },
        "progress_percent": round(progress, 1),
        "works_total": len(stages),
        "works_done": len(done),
        "works_active": active.name if active else None,
        "materials_total": len(picks),
        "materials_need_buy": len(need_buy),
        "materials_delivered": len(delivered),
        "issues_open": len(open_issues),
        "issues_critical": len([i for i in open_issues if i.severity in ("critical", "high")]),
        "estimate_lines": len(lines),
        "next_action": na,
        "stages": stage_cards,
        "works": [
            {
                "id": s.id,
                "name": s.name,
                "status": s.status.value,
                "percent_complete": s.percent_complete,
                "planned_end": s.planned_end.isoformat() if s.planned_end else None,
            }
            for s in stages[:12]
        ],
        "materials": [
            {
                "id": p.id,
                "name": p.name,
                "status": getattr(p.status, "value", p.status),
                "qty_needed": getattr(p, "qty_needed", None) or getattr(p, "qty", None),
                "qty_delivered": getattr(p, "qty_delivered", 0),
            }
            for p in picks[:15]
        ],
    }
