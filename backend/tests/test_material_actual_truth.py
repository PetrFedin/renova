"""P0 #379: planned quantity must never be substituted as material actual."""
from types import SimpleNamespace

import pytest

from app.api.v1 import analytics as analytics_api
from app.models.entities import EstimateLine, LineType
from app.services.estimate_service import material_actual_total, material_stats


def _line(
    *,
    line_type: LineType = LineType.material,
    planned: float,
    actual: float | None,
    price: float,
) -> EstimateLine:
    return EstimateLine(
        line_type=line_type,
        name="truth-test",
        unit="pcs",
        quantity_planned=planned,
        quantity_actual=actual,
        unit_price=price,
    )


def test_material_actual_zero_is_not_replaced_by_plan():
    line = _line(planned=10, actual=0, price=25)

    assert material_actual_total([line]) == 0
    assert material_stats([line]) == {
        "planned": 250,
        "actual": 0,
        "overrun_percent": -100.0,
    }


def test_material_actual_positive_quantity_is_counted_and_work_lines_are_ignored():
    material = _line(planned=10, actual=4, price=25)
    work = _line(line_type=LineType.work, planned=3, actual=3, price=1000)

    assert material_actual_total([material, work]) == 100
    assert material_stats([material, work]) == {
        "planned": 250,
        "actual": 100,
        "overrun_percent": -60.0,
    }


def test_defensive_none_actual_does_not_manufacture_fact_from_plan():
    # The persisted ORM column is non-null/default 0. This defensive case proves
    # that even an unflushed/legacy object with None cannot turn plan into fact.
    line = _line(planned=8, actual=None, price=50)

    assert material_actual_total([line]) == 0
    assert material_stats([line])["actual"] == 0


@pytest.mark.asyncio
async def test_project_analytics_reuses_same_explicit_actual_semantics(monkeypatch):
    material = _line(planned=10, actual=0, price=25)
    project = SimpleNamespace(
        estimate_lines=[material],
        stages=[],
        budget_planned=250,
        budget_spent=0,
        planned_end_date=None,
    )

    async def fake_require_project(db, project_id, user, write=False):
        assert project_id == "project-zero"
        assert write is False
        return project

    monkeypatch.setattr(analytics_api, "require_project", fake_require_project)

    result = await analytics_api.analytics(
        "project-zero",
        user=SimpleNamespace(id="customer-zero"),
        db=SimpleNamespace(),
    )

    assert result["materials_plan"] == 250
    assert result["materials_fact"] == 0
    assert result["budget_spent"] == 0
