from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from app import observability_alert_probe_cli as cli
from app.core.observability_alert_probe import AlertProbeEmissionError


_REPO_ROOT = Path(__file__).resolve().parents[2]


def _receipt() -> SimpleNamespace:
    return SimpleNamespace(
        to_dict=lambda: {
            "probe_id": "11111111-2222-4333-8444-555555555555",
            "emitted_at": "2026-08-26T16:00:00+00:00",
            "environment": "staging",
            "release": "abc123",
            "artifact_digest": "sha256:deadbeef",
            "sentry_event_id": "event-123",
            "sentry_emitted": True,
            "trace_emitted": True,
            "metric_emitted": True,
            "external_delivery_confirmed": False,
        }
    )


def test_cli_refuses_without_explicit_staging_confirmation(monkeypatch, capsys):
    called = False

    def should_not_emit(**_kwargs):
        nonlocal called
        called = True
        raise AssertionError("probe must not run")

    monkeypatch.setattr(cli, "emit_staging_alert_probe", should_not_emit)

    assert cli.main([]) == 2
    assert called is False
    assert "--confirm-staging" in capsys.readouterr().err


def test_cli_emits_truthful_json_receipt(monkeypatch, capsys):
    monkeypatch.setattr(cli, "setup_logging", lambda: None)
    monkeypatch.setattr(cli, "emit_staging_alert_probe", lambda **_kwargs: _receipt())

    assert cli.main(["--confirm-staging", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["probe_id"] == "11111111-2222-4333-8444-555555555555"
    assert payload["sentry_emitted"] is True
    assert payload["trace_emitted"] is True
    assert payload["metric_emitted"] is True
    assert payload["external_delivery_confirmed"] is False


def test_cli_returns_distinct_failure_for_incomplete_local_emission(monkeypatch, capsys):
    monkeypatch.setattr(cli, "setup_logging", lambda: None)

    def fail(**_kwargs):
        raise AlertProbeEmissionError("local observability probe emission incomplete: sentry")

    monkeypatch.setattr(cli, "emit_staging_alert_probe", fail)

    assert cli.main(["--confirm-staging"]) == 3
    assert "failed locally" in capsys.readouterr().err


def test_cli_is_inside_runtime_image_copy_boundary():
    dockerfile = (_REPO_ROOT / "backend/Dockerfile").read_text()
    cli_path = _REPO_ROOT / "backend/app/observability_alert_probe_cli.py"

    assert cli_path.is_file()
    assert "COPY --chown=10001:10001 backend/app /app/app" in dockerfile
    assert "COPY --chown=10001:10001 backend/scripts" not in dockerfile
