from pathlib import Path
from types import SimpleNamespace

from app.services import stage_status_service as progress_svc
from app.services.risk_engine import forecast_overrun


def _stage(percent: float, weight: float):
    return SimpleNamespace(percent_complete=percent, weight_coefficient=weight)


def test_weighted_project_progress_snapshot_is_canonical():
    stages = [_stage(0, 0.8), _stage(100, 0.2)]

    snapshot = progress_svc.project_progress_snapshot(stages)

    assert snapshot["value"] == 20.0
    assert snapshot["source"] == "stage_weighted_progress"
    assert snapshot["calculation_version"] == "weighted-stage-v1"
    assert snapshot["stage_count"] == 2
    assert snapshot["weight_total"] == 1.0
    assert progress_svc.project_progress(stages) == 20.0


def test_zero_weight_falls_back_to_arithmetic_mean():
    stages = [_stage(25, 0), _stage(75, 0)]

    snapshot = progress_svc.project_progress_snapshot(stages)

    assert snapshot["value"] == 50.0
    assert snapshot["weight_total"] == 0.0


def test_forecast_does_not_extrapolate_before_progress_is_mature():
    assert forecast_overrun(1_000_000, 100_000, 0) == 0
    assert forecast_overrun(1_000_000, 100_000, 4.9) == 0
    assert forecast_overrun(1_000_000, 100_000, 5) == 1_000_000


def test_project_level_consumers_do_not_reimplement_progress_math():
    backend = Path(__file__).resolve().parents[1]
    files = [
        backend / "app" / "api" / "v1" / "analytics.py",
        backend / "app" / "services" / "risk_engine.py",
        backend / "app" / "services" / "schedule_service.py",
        backend / "app" / "services" / "ai_insights_service.py",
        backend / "app" / "services" / "project_service.py",
        backend / "app" / "api" / "v1" / "projects.py",
    ]
    for path in files:
        source = path.read_text(encoding="utf-8")
        assert "sum(s.percent_complete for s in" not in source, path
        assert "max(p.progress_percent, 1)" not in source, path


def test_analytics_and_forecast_expose_progress_provenance():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "api" / "v1" / "analytics.py").read_text(encoding="utf-8")

    assert source.count("project_progress_snapshot") >= 3
    assert '"progress_source"' in source
    assert '"progress_calculation_version"' in source
    assert '"forecast_status"' in source
