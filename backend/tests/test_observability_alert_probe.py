from __future__ import annotations

import json
import logging

import pytest

from app.core.config import Settings
from app.core import logging_config
from app.core import observability_alert_probe as probe


PROBE_ID = "11111111-2222-4333-8444-555555555555"


def _settings(**overrides) -> Settings:
    values = {
        "environment": "staging",
        "sentry_dsn": "https://public@example.invalid/1",
        "otel_exporter_otlp_endpoint": "https://otel.example.invalid:4317",
        "otel_exporter_otlp_insecure": False,
        "otel_service_name": "renova-api",
        "sentry_traces_sample_rate": 0.1,
        "otel_traces_sample_rate": 0.1,
        "log_json": True,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _release_identity(monkeypatch) -> None:
    monkeypatch.setenv("RENOVA_GIT_SHA", "abc123")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:deadbeef")


class _FakeSpan:
    def __init__(self) -> None:
        self.attributes: dict[str, object] = {}
        self.exceptions: list[BaseException] = []
        self.status = None

    def set_attribute(self, key, value) -> None:
        self.attributes[key] = value

    def record_exception(self, error) -> None:
        self.exceptions.append(error)

    def set_status(self, status) -> None:
        self.status = status


class _SpanContext:
    def __init__(self, span: _FakeSpan) -> None:
        self.span = span

    def __enter__(self):
        return self.span

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeTracer:
    def __init__(self, span: _FakeSpan) -> None:
        self.span = span

    def start_as_current_span(self, _name: str):
        return _SpanContext(self.span)


class _FakeTracerProvider:
    def __init__(self, span: _FakeSpan) -> None:
        self.span = span

    def get_tracer(self, _name: str):
        return _FakeTracer(self.span)


class _FakeCounter:
    def __init__(self) -> None:
        self.calls: list[tuple[int, dict[str, object]]] = []

    def add(self, value: int, attributes: dict[str, object]) -> None:
        self.calls.append((value, attributes))


class _FakeMeter:
    def __init__(self, counter: _FakeCounter) -> None:
        self.counter = counter

    def create_counter(self, *_args, **_kwargs):
        return self.counter


class _FakeMeterProvider:
    def __init__(self, counter: _FakeCounter) -> None:
        self.counter = counter

    def get_meter(self, _name: str):
        return _FakeMeter(self.counter)


class _FakeRuntime:
    def __init__(self) -> None:
        self.span = _FakeSpan()
        self.counter = _FakeCounter()
        self.tracer_provider = _FakeTracerProvider(self.span)
        self.meter_provider = _FakeMeterProvider(self.counter)
        self.shutdown_calls = 0

    def shutdown(self) -> None:
        self.shutdown_calls += 1


def test_probe_is_staging_only(monkeypatch):
    _release_identity(monkeypatch)
    with pytest.raises(probe.AlertProbeConfigurationError, match="staging-only"):
        probe.validate_alert_probe_configuration(_settings(environment="production"))


def test_probe_requires_external_secure_sinks_json_logs_and_release_identity(monkeypatch):
    _release_identity(monkeypatch)

    with pytest.raises(probe.AlertProbeConfigurationError, match="SENTRY_DSN"):
        probe.validate_alert_probe_configuration(_settings(sentry_dsn=None))

    with pytest.raises(probe.AlertProbeConfigurationError, match="non-local"):
        probe.validate_alert_probe_configuration(
            _settings(otel_exporter_otlp_endpoint="https://localhost:4317")
        )

    with pytest.raises(probe.AlertProbeConfigurationError, match="secure OTLP"):
        probe.validate_alert_probe_configuration(_settings(otel_exporter_otlp_insecure=True))

    with pytest.raises(probe.AlertProbeConfigurationError, match="LOG_JSON"):
        probe.validate_alert_probe_configuration(_settings(log_json=False))

    monkeypatch.delenv("RENOVA_GIT_SHA")
    with pytest.raises(probe.AlertProbeConfigurationError, match="RENOVA_GIT_SHA"):
        probe.validate_alert_probe_configuration(_settings())


def test_probe_emits_correlated_error_trace_metric_but_never_claims_delivery(monkeypatch, caplog):
    _release_identity(monkeypatch)
    runtime = _FakeRuntime()
    tags: list[tuple[str, str]] = []
    captured: list[BaseException] = []

    monkeypatch.setattr(
        probe,
        "configure_worker_observability",
        lambda _configured: runtime,
    )
    monkeypatch.setattr(
        probe.sentry_sdk,
        "set_tag",
        lambda key, value: tags.append((key, value)),
    )

    def capture_exception(error):
        captured.append(error)
        return "event-123"

    monkeypatch.setattr(probe.sentry_sdk, "capture_exception", capture_exception)

    with caplog.at_level(logging.ERROR, logger="renova.observability.alert_probe"):
        receipt = probe.emit_staging_alert_probe(
            probe_id=PROBE_ID,
            configured=_settings(),
        )

    assert receipt.probe_id == PROBE_ID
    assert receipt.release == "abc123"
    assert receipt.artifact_digest == "sha256:deadbeef"
    assert receipt.sentry_event_id == "event-123"
    assert receipt.sentry_emitted is True
    assert receipt.trace_emitted is True
    assert receipt.metric_emitted is True
    assert receipt.external_delivery_confirmed is False
    assert runtime.shutdown_calls == 1

    assert len(captured) == 1
    assert isinstance(captured[0], probe.SyntheticAlertProbeError)
    assert ("renova.alert_probe_id", PROBE_ID) in tags
    assert ("renova.synthetic", "true") in tags

    assert runtime.span.attributes["renova.alert_probe_id"] == PROBE_ID
    assert runtime.span.attributes["renova.synthetic"] is True
    assert len(runtime.span.exceptions) == 1

    assert runtime.counter.calls == [
        (
            1,
            {
                "renova.synthetic": True,
                "deployment.environment.name": "staging",
            },
        )
    ]
    # The per-run UUID must not become a metric label and create cardinality churn.
    assert "renova.alert_probe_id" not in runtime.counter.calls[0][1]

    record = caplog.records[-1]
    assert record.event_kind == "observability_alert_probe"
    assert record.probe_id == PROBE_ID
    assert record.synthetic is True
    assert "external_delivery_confirmed=false" in record.getMessage()


def test_probe_rejects_non_uuid_operator_identity(monkeypatch):
    _release_identity(monkeypatch)
    with pytest.raises(probe.AlertProbeConfigurationError, match="UUID"):
        probe.emit_staging_alert_probe(
            probe_id="not-a-probe-id",
            configured=_settings(),
        )


def test_json_formatter_exposes_only_allowlisted_event_fields(monkeypatch):
    configured = _settings()
    monkeypatch.setattr(logging_config, "settings", configured)
    _release_identity(monkeypatch)

    record = logging.LogRecord(
        name="renova.observability.alert_probe",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="synthetic probe",
        args=(),
        exc_info=None,
    )
    record.event_kind = "observability_alert_probe"
    record.probe_id = PROBE_ID
    record.synthetic = True
    record.user_id = "must-not-be-exported"
    record.authorization = "must-not-be-exported"

    payload = json.loads(logging_config.JsonFormatter().format(record))

    assert payload["event_kind"] == "observability_alert_probe"
    assert payload["probe_id"] == PROBE_ID
    assert payload["synthetic"] is True
    assert "user_id" not in payload
    assert "authorization" not in payload
