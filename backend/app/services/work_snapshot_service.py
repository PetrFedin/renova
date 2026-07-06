"""Work Snapshot Renova OS — dashboard работы, gate завершения, next action."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Expense, MaterialPick, ProjectIssue, Stage, StageStatus
from app.services import dependency_service as dep_svc
from app.services import workflow_service as wf
from app.services.stage_service import parse_room_ids
from app.services import stage_status_service as st_status


def _photos_after(stage: Stage) -> bool:
    for p in getattr(stage, "photos", []) or []:
        cap = (p.caption or "").lower()
        if "после" in cap or "after" in cap or "результат" in cap:
            return True
    return len(getattr(stage, "photos", []) or []) >= 2


def _photos_before(stage: Stage) -> bool:
    for p in getattr(stage, "photos", []) or []:
        cap = (p.caption or "").lower()
        if "до" in cap or "before" in cap:
            return True
    return bool(getattr(stage, "photos", []) or [])


async def completion_check(db: AsyncSession, stage: Stage, project) -> dict:
    """Проверки §3.21 перед завершением работы."""
    checks: list[dict] = []
    assignee = getattr(stage, "assignee_id", None) or getattr(project, "contractor_id", None)
    if not assignee:
        checks.append({"id": "assignee", "ok": False, "message": "Назначьте исполнителя", "action": "assign", "button": "Назначить"})

    cl = wf.stage_checklist(stage)
    prog = wf.checklist_progress(cl)
    if cl and prog < 100:
        checks.append({"id": "checklist", "ok": False, "message": f"Чек-лист {prog}% — выполните все пункты", "action": "checklist", "button": "Открыть чек-лист"})

    if not _photos_after(stage):
        checks.append({"id": "photos_after", "ok": False, "message": "Не добавлены фотографии результата", "action": "photos", "button": "Добавить фото"})

    issues = (await db.execute(select(ProjectIssue).where(ProjectIssue.stage_id == stage.id))).scalars().all()
    critical = [i for i in issues if i.severity in ("critical", "high") and i.status != "closed"]
    if critical:
        checks.append({"id": "issues", "ok": False, "message": f"Открыты критичные замечания: {len(critical)}", "action": "issues", "button": "Исправить"})

    picks = (await db.execute(select(MaterialPick).where(MaterialPick.stage_id == stage.id))).scalars().all()
    missing = [p for p in picks if getattr(p, "qty_needed", 0) and getattr(p, "qty_delivered", 0) < getattr(p, "qty_needed", p.qty or 0)]
    if missing:
        checks.append({"id": "materials", "ok": False, "message": f"Не хватает материалов: {len(missing)}", "action": "materials", "button": "Материалы"})

    blocked = await dep_svc.evaluate_stage(db, stage)
    if blocked.get("blocked"):
        reasons = blocked.get("reasons") or []
        msg = reasons[0].get("title") or reasons[0].get("message") if reasons else "Есть блокирующие зависимости"
        checks.append({"id": "dependencies", "ok": False, "message": msg, "action": "blocked", "button": "Подробнее"})

    failed = [c for c in checks if not c.get("ok", True)]
    return {"ok": len(failed) == 0, "checks": checks, "failed": failed}


def next_action(stage: Stage, role: str, *, completion_ok: bool = True) -> dict:
    """Одно следующее действие для работы §3.10."""
    st = stage.status
    if st == StageStatus.planned:
        return {"title": "Начать работу", "button": "Начать", "kind": "start", "href": f"/stage/{stage.id}"}
    if st == StageStatus.active:
        if getattr(stage, "needs_rework", False):
            return {"title": "Исправить замечания", "button": "Открыть", "kind": "rework", "href": f"/stage/{stage.id}"}
        if not _photos_before(stage):
            return {"title": "Добавить фото до начала", "button": "Добавить фото", "kind": "photos", "href": f"/stage/{stage.id}"}
        if not completion_ok:
            return {"title": "Завершить работу", "button": "Проверить готовность", "kind": "complete", "href": f"/stage/{stage.id}"}
        return {"title": "Запросить приёмку", "button": "На приёмку", "kind": "acceptance", "href": f"/stage/{stage.id}"}
    if st == StageStatus.review:
        if role == "customer":
            return {"title": "Проверить работу", "button": "Принять", "kind": "accept", "href": f"/stage/{stage.id}"}
        return {"title": "Ждёт приёмки заказчиком", "button": "Открыть", "kind": "wait", "href": f"/stage/{stage.id}"}
    if st == StageStatus.done:
        return {"title": "Работа завершена", "button": "Архив", "kind": "done", "href": f"/stage/{stage.id}"}
    return {"title": "Открыть работу", "button": "Открыть", "kind": "open", "href": f"/stage/{stage.id}"}


async def build_work_snapshot(db: AsyncSession, stage: Stage, project, *, role: str = "customer") -> dict:
    await wf.ensure_stage_checklist(db, stage)
    cl = wf.stage_checklist(stage)
    prog = wf.checklist_progress(cl)
    stage.percent_complete = float(prog)

    comp = await completion_check(db, stage, project)
    blocked = await dep_svc.evaluate_stage(db, stage)
    na = next_action(stage, role, completion_ok=comp["ok"])

    room_ids = parse_room_ids(stage)
    room_id = room_ids[0] if room_ids else None
    room_name = next((r.name for r in (project.rooms or []) if r.id == room_id), None)

    issues = (await db.execute(select(ProjectIssue).where(ProjectIssue.stage_id == stage.id))).scalars().all()
    picks = (await db.execute(select(MaterialPick).where(MaterialPick.stage_id == stage.id))).scalars().all()
    photos = getattr(stage, "photos", []) or []
    expenses = (await db.execute(select(Expense).where(Expense.stage_id == stage.id, Expense.status == "confirmed"))).scalars().all()
    spent = sum(e.amount or 0 for e in expenses)
    works_total, works_done = st_status.works_counts(stage)
    waiting_materials = any(getattr(p.status, "value", p.status) in ("draft", "pending", "ordered") for p in picks)
    disp = st_status.compute_display_status(stage, blocked=blocked.get("blocked", False), waiting_materials=waiting_materials)
    delay = st_status.delay_days(stage)
    mat_delivered = len([p for p in picks if getattr(p.status, "value", p.status) in ("purchased", "delivered")])
    mat_need = len([p for p in picks if getattr(p.status, "value", p.status) in ("draft", "pending")])

    status_label = stage.status.value
    if blocked.get("blocked"):
        status_label = blocked.get("status_label") or "waiting_material"
    if getattr(stage, "needs_rework", False):
        status_label = "rework"

    return {
        "id": stage.id,
        "name": stage.name,
        "room_id": room_id,
        "room_name": room_name,
        "work_type": getattr(stage, "work_type", None),
        "status": stage.status.value,
        "status_label": status_label,
        "blocked": blocked.get("blocked", False),
        "blocked_reasons": blocked.get("reasons", []),
        "percent_complete": prog,
        "planned_start": stage.planned_start.isoformat() if stage.planned_start else None,
        "planned_end": stage.planned_end.isoformat() if stage.planned_end else None,
        "actual_start": stage.actual_start.isoformat() if getattr(stage, "actual_start", None) else None,
        "actual_end": stage.actual_end.isoformat() if getattr(stage, "actual_end", None) else None,
        "payment_amount": stage.payment_amount,
        "assignee_id": getattr(stage, "assignee_id", None) or getattr(project, "contractor_id", None),
        "checklist": cl,
        "checklist_progress": {"done": sum(1 for i in cl if i.get("done")), "total": len(cl), "percent": prog},
        "photos_count": len(photos),
        "materials_count": len(picks),
        "issues_open": len([i for i in issues if i.status != "closed"]),
        "issues_critical": len([i for i in issues if i.severity in ("critical", "high") and i.status != "closed"]),
        "completion": comp,
        "next_action": na,
        "display_status": disp,
        "display_status_label": st_status.display_status_label(disp),
        "works_total": works_total,
        "works_done": works_done,
        "overdue_days": delay,
        "budget": {
            "planned": round(stage.payment_amount or 0, 2),
            "spent": round(spent, 2),
            "variance": round(spent - (stage.payment_amount or 0), 2),
        },
        "materials": {
            "total": len(picks),
            "delivered": mat_delivered,
            "need_buy": mat_need,
            "ordered": len([p for p in picks if getattr(p.status, "value", p.status) == "ordered"]),
        },
    }
