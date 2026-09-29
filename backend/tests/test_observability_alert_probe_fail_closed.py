from __future__ import annotations

import logging

import pytest

from app.core.config import Settings
from app.core import observability_alert_probe as probe


PROBE_ID = "11111111-2222-4333-8444-555555555555"


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        environment="staging",
        sentry_dsn="https://public@example.invalid/1",
        otel_exporter_otlp_endpoint="https://otel.example.invalid:4317",
        otel_exporter_otlp_insecure=False,
        otel_service_name="renova-api",
        sentry_traces_sample_rate=0.1,
        otel_traces_sample_rate=0.1,
        log_json=True,
    )


class _RuntimeWithoutOtelEmission:
    tracer_provider = None
    meter_provider = None

    def __init__(self) -> None:
        self.shutdown_calls = 0

    def shutdown(self) -> None:
        self.shutdown_calls += 1


def test_incomplete_local_emission_is_not_reported_as_success(monkeypatch, caplog):
    monkeypatch.setenv("RENOVA_GIT_SHA", "abc123")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:deadbeef")
    runtime = _RuntimeWithoutOtelEmission()

    monkeypatch.setattr(
        probe,
        "configure_worker_observability",
        lambda _configured: runtime,
    )
    monkeypatch.setattr(probe.sentry_sdk, "set_tag", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(probe.sentry_sdk, "capture_exception", lambda _error: None)

    with caplog.at_level(logging.ERROR, logger="renova.observability.alert_probe"):
        with pytest.raises(
            probe.AlertProbeEmissionError,
            match="local observability probe emission incomplete: sentry,trace,metric",
        ):
            probe.emit_staging_alert_probe(
                probe_id=PROBE_ID,
                configured=_settings(),
            )

    assert runtime.shutdown_calls == 1
    assert all(
        getattr(record, "event_kind", None) != "observability_alert_probe"
        for record in caplog.records
    )
    assert "external_delivery_confirmed=false" not in caplog.text
