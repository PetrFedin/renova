from __future__ import annotations

from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.models.entities import PaymentStatus, StageStatus, UserRole
from app.services import dashboard_integrity_service as dashboard_svc


def _stage(
    stage_id: str,
    *,
    status: StageStatus,
    percent: float,
    order: int,
    assignee_id: str | None = None,
):
    return SimpleNamespace(
        id=stage_id,
        name=f"Stage {stage_id}",
        status=status,
        percent_complete=percent,
        sort_order=order,
        weight_coefficient=1,
        assignee_id=assignee_id,
    )


def _project(stages):
    return SimpleNamespace(
        id="project-1",
        name="Read integrity",
        stages=list(stages),
        estimate_lines=[],
        budget_planned=100_000,
        budget_spent=25_000,
        vat_rate=20,
        planned_start_date=date(2026, 1, 1),
        planned_end_date=date(2026, 12, 31),
        payments=[SimpleNamespace(status=PaymentStatus.pending)],
        contractor_id="contractor-1",
    )


def test_contractor_scope_does_not_mutate_project_relationship():
    assigned = _stage(
        "assigned",
        status=StageStatus.active,
        percent=50,
        order=1,
        assignee_id="contractor-1",
    )
    hidden = _stage(
        "hidden",
        status=StageStatus.planned,
        percent=0,
        order=2,
        assignee_id="contractor-2",
    )
    project = _project([assigned, hidden])
    user = SimpleNamespace(id="contractor-1", role=UserRole.contractor)

    visible = dashboard_svc.stages_for_user(project, user)
    dashboard = dashboard_svc.build_dashboard_read_model(project, stages=visible)

    assert [stage.id for stage in visible] == ["assigned"]
    assert [stage.id for stage in project.stages] == ["assigned", "hidden"]
    assert dashboard["progress_percent"] == 50.0
    assert dashboard["next_action_title"] == "В работе: Stage assigned"


def test_customer_scope_keeps_all_sorted_stages():
    late = _stage("late", status=StageStatus.planned, percent=0, order=2)
    first = _stage("first", status=StageStatus.active, percent=10, order=1)
    project = _project([late, first])
    user = SimpleNamespace(id="customer-1", role=UserRole.customer)

    assert [stage.id for stage in dashboard_svc.stages_for_user(project, user)] == [
        "first",
        "late",
    ]
    assert [stage.id for stage in project.stages] == ["late", "first"]


def test_completed_dashboard_has_terminal_action_type():
    done = _stage("done", status=StageStatus.done, percent=100, order=1)
    dashboard = dashboard_svc.build_dashboard_read_model(_project([done]), stages=[done])

    assert dashboard["next_action_title"] == "Проект завершён"
    assert dashboard["next_action_type"] == "completed"


def test_assignment_completion_does_not_claim_global_project_completion():
    assigned_done = _stage(
        "assigned",
        status=StageStatus.done,
        percent=100,
        order=1,
        assignee_id="contractor-1",
    )
    hidden_active = _stage(
        "hidden",
        status=StageStatus.active,
        percent=20,
        order=2,
        assignee_id="contractor-2",
    )
    project = _project([assigned_done, hidden_active])

    dashboard = dashboard_svc.build_dashboard_read_model(project, stages=[assigned_done])

    assert dashboard["next_action_title"] == "Назначенные работы выполнены"
    assert dashboard["next_action_type"] == "completed"


def test_contractor_without_visible_stages_is_not_told_to_add_project_stages():
    hidden = _stage(
        "hidden",
        status=StageStatus.active,
        percent=20,
        order=1,
        assignee_id="contractor-2",
    )
    dashboard = dashboard_svc.build_dashboard_read_model(_project([hidden]), stages=[])

    assert dashboard["next_action_title"] == "Нет назначенных этапов"
    assert dashboard["next_action_type"] == "review_estimate"


def test_planned_only_dashboard_is_not_marked_completed():
    planned = _stage("planned", status=StageStatus.planned, percent=0, order=1)
    dashboard = dashboard_svc.build_dashboard_read_model(
        _project([planned]),
        stages=[planned],
    )

    assert dashboard["next_action_title"] == "Следующий этап: Stage planned"
    assert dashboard["next_action_type"] == "review_estimate"


def test_empty_dashboard_is_not_marked_completed():
    dashboard = dashboard_svc.build_dashboard_read_model(_project([]), stages=[])

    assert dashboard["next_action_title"] == "Добавьте этапы и смету"
    assert dashboard["next_action_type"] == "review_estimate"


@pytest.mark.asyncio
async def test_enrichment_failure_is_explicit(monkeypatch):
    class BrokenSession:
        async def __aenter__(self):
            raise RuntimeError("database unavailable")

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(dashboard_svc, "SessionLocal", lambda: BrokenSession())

    result = await dashboard_svc.enrich_dashboard_read_only(
        "project-1",
        {"alerts": [], "next_action_type": "completed"},
        role="customer",
    )

    assert result["degraded"] is True
    assert result["data_quality"]["actions"] == "unavailable"
    assert result["data_quality"]["margin_snapshot"] == "read_only_no_write"
    assert "Часть данных панели временно недоступна" in result["alerts"]


def test_api_router_exposes_exactly_one_canonical_dashboard_route():
    from app.api.v1.router import api_router

    matches = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == "/api/v1/projects/{project_id}/dashboard"
        and "GET" in (getattr(route, "methods", None) or set())
    ]

    assert len(matches) == 1
    assert matches[0].endpoint.__module__ == "app.api.v1.project_dashboard"


def test_canonical_dashboard_endpoint_is_read_only_by_source_contract():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "api" / "v1" / "project_dashboard.py").read_text(
        encoding="utf-8"
    )

    assert "db.commit" not in source
    assert "db.add" not in source
    assert "MarginSnapshot" not in source
    assert "build_dashboard_read_model" in source
    assert "enrich_dashboard_read_only" in source


def test_router_replacement_is_fail_closed():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "api" / "v1" / "router.py").read_text(encoding="utf-8")

    assert "len(matches) != 1" in source
    assert "projects.router.routes.remove(matches[0])" in source
    assert source.index("api_router.include_router(project_dashboard.router)") < source.index(
        "api_router.include_router(projects.router)"
    )
