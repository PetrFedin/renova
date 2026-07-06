"""Календарь: этапы, оплаты, приёмки, заказы работ — единая лента событий."""
from app.models.entities import Payment, PaymentStatus, Project, Stage, StageStatus


def _append_stage_period(events: list, stage: Stage) -> None:
    """Один этап = одна запись с периодом, без дублирующих «Старт/Финиш»."""
    start = stage.planned_start
    end = stage.planned_end or start
    if not start and not stage.planned_end:
        return
    anchor = start or stage.planned_end
    end_iso = end.isoformat() if end and start and end != start else None
    events.append({
        "id": f"stage-period-{stage.id}",
        "kind": "stage_period",
        "title": stage.name,
        "date": anchor.isoformat(),
        "end_date": end_iso,
        "stage_id": stage.id,
        "uid": getattr(stage, "ical_uid", None) or f"renova-{stage.id}@app",
        "status": stage.status.value,
    })


def _append_work_period(events: list, wo) -> None:
    """Одна задача = одна запись; в один день может быть несколько задач."""
    start = wo.planned_start
    end = wo.planned_end or start
    if not start and not wo.planned_end:
        return
    anchor = start or wo.planned_end
    end_iso = end.isoformat() if end and start and end != start else None
    st = wo.status.value if hasattr(wo.status, "value") else wo.status
    events.append({
        "id": f"work-period-{wo.id}",
        "kind": "work_period",
        "title": wo.title,
        "date": anchor.isoformat(),
        "end_date": end_iso,
        "work_order_id": wo.id,
        "room_id": wo.room_id,
        "stage_id": wo.stage_id,
        "status": st,
    })


def build_calendar(project: Project, waste_orders=None) -> dict:
    events = []
    for s in sorted(project.stages, key=lambda x: x.sort_order):
        _append_stage_period(events, s)
        if s.contractor_ready_at:
            events.append({
                "id": f"ready-{s.id}",
                "kind": "contractor_ready",
                "title": f"Готово: {s.name}",
                "date": s.contractor_ready_at.date().isoformat(),
                "stage_id": s.id, "uid": getattr(s, "ical_uid", None) or f"renova-{s.id}@app",
                "status": s.status.value,
            })
        if s.customer_accepted_at:
            events.append({
                "id": f"accepted-{s.id}",
                "kind": "customer_accepted",
                "title": f"Принято: {s.name}",
                "date": s.customer_accepted_at.date().isoformat(),
                "stage_id": s.id, "uid": getattr(s, "ical_uid", None) or f"renova-{s.id}@app",
                "status": s.status.value,
            })

    for p in getattr(project, "payments", []) or []:
        if p.status == PaymentStatus.confirmed and p.confirmed_at:
            events.append({
                "id": f"pay-{p.id}",
                "kind": "payment",
                "title": p.title,
                "date": p.confirmed_at.date().isoformat(),
                "amount": p.amount,
            })

    for wo in getattr(project, "work_orders", []) or []:
        _append_work_period(events, wo)
        if wo.actual_end:
            st = wo.status.value if hasattr(wo.status, "value") else wo.status
            events.append({
                "id": f"wo-done-{wo.id}",
                "kind": "work_done",
                "title": f"Готово: {wo.title}",
                "date": wo.actual_end.isoformat(),
                "work_order_id": wo.id,
                "room_id": wo.room_id,
                "status": st,
            })

    events.sort(key=lambda e: (e["date"], e.get("kind", ""), e.get("title", "")))
    return {
        "project_id": project.id,
        "planned_start": project.planned_start_date.isoformat() if project.planned_start_date else None,
        "planned_end": project.planned_end_date.isoformat() if project.planned_end_date else None,
        "events": events,
        "stages": [
            {
                "id": s.id,
                "name": s.name,
                "status": s.status.value,
                "planned_start": s.planned_start.isoformat() if s.planned_start else None,
                "planned_end": s.planned_end.isoformat() if s.planned_end else None,
            }
            for s in sorted(project.stages, key=lambda x: x.sort_order)
        ],
    }


async def get_calendar(db, project_id: str) -> dict:
    from app.services import project_service as ps
    p = await ps.get_project(db, project_id)
    return build_calendar(p) if p else {"events": []}
