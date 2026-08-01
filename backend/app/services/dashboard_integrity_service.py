"""Read-only dashboard composition and explicit degradation semantics."""
from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Iterable

from app.db import session as db_session
from app.services import project_service as project_svc

logger = logging.getLogger(__name__)

_DEGRADED_ALERT = "Часть данных панели временно недоступна"


def SessionLocal():
    """Resolve the active sessionmaker lazily while retaining a test injection seam."""
    return db_session.SessionLocal()


def _status_value(stage) -> str:
    status = getattr(stage, "status", "")
    return getattr(status, "value", None) or str(status or "")


def stages_for_user(project, user) -> list:
    """Return a role-scoped stage list without assigning to the ORM relationship."""
    stages = sorted(getattr(project, "stages", None) or [], key=lambda item: item.sort_order)
    role = getattr(getattr(user, "role", None), "value", None) or str(getattr(user, "role", "") or "")
    if role != "contractor":
        return stages
    return [
        stage
        for stage in stages
        if getattr(stage, "assignee_id", None) == user.id
        or (
            getattr(stage, "assignee_id", None) is None
            and getattr(project, "contractor_id", None) == user.id
        )
    ]


def build_dashboard_read_model(project, *, stages: Iterable) -> dict:
    """Build dashboard from a detached projection without mutating ORM relationships."""
    project_stages = list(getattr(project, "stages", None) or [])
    scoped_stages = list(stages)
    projection = SimpleNamespace(
        id=project.id,
        name=project.name,
        stages=scoped_stages,
        estimate_lines=list(getattr(project, "estimate_lines", None) or []),
        budget_planned=getattr(project, "budget_planned", 0) or 0,
        budget_spent=getattr(project, "budget_spent", 0) or 0,
        vat_rate=getattr(project, "vat_rate", 0) or 0,
        planned_start_date=getattr(project, "planned_start_date", None),
        planned_end_date=getattr(project, "planned_end_date", None),
        payments=list(getattr(project, "payments", None) or []),
    )
    dashboard = project_svc.build_dashboard(projection)

    planned = next((stage for stage in scoped_stages if _status_value(stage) == "planned"), None)
    scoped_all_done = bool(scoped_stages) and all(
        _status_value(stage) == "done" for stage in scoped_stages
    )
    project_all_done = bool(project_stages) and all(
        _status_value(stage) == "done" for stage in project_stages
    )

    if planned is not None:
        dashboard["next_action_title"] = f"Следующий этап: {planned.name}"
        dashboard["next_action_type"] = "review_estimate"
    elif scoped_all_done and project_all_done:
        dashboard["next_action_title"] = "Проект завершён"
        dashboard["next_action_type"] = "completed"
    elif scoped_all_done:
        dashboard["next_action_title"] = "Назначенные работы выполнены"
        dashboard["next_action_type"] = "completed"
    elif not scoped_stages and project_stages:
        dashboard["next_action_title"] = "Нет назначенных этапов"
        dashboard["next_action_type"] = "review_estimate"
    elif not project_stages:
        dashboard["next_action_title"] = "Добавьте этапы и смету"
        dashboard["next_action_type"] = "review_estimate"
    elif dashboard.get("next_action_title") == "Проект завершён":
        dashboard["next_action_title"] = "Проверьте состояние этапов"
        dashboard["next_action_type"] = "review_estimate"

    return dashboard


async def enrich_dashboard_read_only(project_id: str, dashboard: dict, *, role: str | None) -> dict:
    """Enrich in an isolated session so an optional query cannot poison the request session."""
    result = dict(dashboard)
    try:
        async with SessionLocal() as db:
            result = await project_svc.enrich_dashboard_actions(db, project_id, result, role=role)
    except Exception:
        logger.exception("dashboard enrichment unavailable project_id=%s", project_id)
        alerts = list(result.get("alerts") or [])
        if _DEGRADED_ALERT not in alerts:
            alerts.append(_DEGRADED_ALERT)
        result["alerts"] = alerts
        result["degraded"] = True
        result["data_quality"] = {
            "actions": "unavailable",
            "dashboard_read": "ready",
            "margin_snapshot": "read_only_no_write",
        }
        return result

    result["degraded"] = False
    result["data_quality"] = {
        "actions": "ready",
        "dashboard_read": "ready",
        "margin_snapshot": "read_only_no_write",
    }
    return result
