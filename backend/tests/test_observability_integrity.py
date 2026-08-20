from __future__ import annotations

import inspect
import json
import logging
from pathlib import Path
import tomllib

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings
from app.core import logging_config, observability
from app.middleware.correlation import CorrelationIdMiddleware, current_correlation_id


_REPO_ROOT = Path(__file__).resolve().parents[2]


def _settings(**overrides) -> Settings:
    values = {
        "environment": "development",
        "sentry_dsn": None,
        "otel_exporter_otlp_endpoint": None,
        "otel_exporter_otlp_insecure": False,
        "otel_service_name": "renova-api",
        "sentry_traces_sample_rate": 0.1,
        "otel_traces_sample_rate": 0.1,
        "log_json": False,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_observability_runtime_dependencies_are_exact_and_locked():
    pyproject = tomllib.loads((_REPO_ROOT / "backend/pyproject.toml").read_text())
    dependencies = pyproject["tool"]["poetry"]["dependencies"]
    assert dependencies["sentry-sdk"] == "2.66.1"
    assert dependencies["opentelemetry-api"] == "1.44.0"
    assert dependencies["opentelemetry-sdk"] == "1.44.0"
    assert dependencies["opentelemetry-exporter-otlp-proto-grpc"] == "1.44.0"
    assert dependencies["opentelemetry-instrumentation-fastapi"] == "0.65b0"

    lock = (_REPO_ROOT / "backend/poetry.lock").read_text()
    for package, version in (
        ("sentry-sdk", "2.66.1"),
        ("opentelemetry-api", "1.44.0"),
        ("opentelemetry-sdk", "1.44.0"),
        ("opentelemetry-exporter-otlp-proto-grpc", "1.44.0"),
        ("opentelemetry-instrumentation-fastapi", "0.65b0"),
    ):
        marker = f'name = "{package}"\nversion = "{version}"'
        assert marker in lock


def test_main_has_one_explicit_observability_bootstrap_without_optional_imports():
    from app import main

    source = inspect.getsource(main)
    assert source.count("configure_observability(app)") == 1
    assert "FastAPIInstrumentor = None" not in source
    assert "import sentry_sdk" not in source
    assert "opentelemetry.instrumentation.fastapi" not in source

    bootstrap = inspect.getsource(observability)
    assert "import sentry_sdk" in bootstrap
    assert "from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor" in bootstrap
    assert "except Exception" not in inspect.getsource(observability.configure_observability)


def test_configured_sentry_initialization_failure_is_fatal(monkeypatch):
    configured = _settings(sentry_dsn="https://public@example.invalid/1")
    app = FastAPI()

    def fail_init(**_kwargs):
        raise RuntimeError("synthetic sentry init failure")

    monkeypatch.setattr(observability.sentry_sdk, "init", fail_init)

    with pytest.raises(RuntimeError, match="synthetic sentry init failure"):
        observability.configure_observability(app, configured)


def test_configured_otel_initialization_failure_is_fatal(monkeypatch):
    configured = _settings(
        otel_exporter_otlp_endpoint="http://collector.internal:4317",
        otel_exporter_otlp_insecure=True,
    )
    app = FastAPI()

    def fail_exporter(*_args, **_kwargs):
        raise RuntimeError("synthetic otlp init failure")

    monkeypatch.setattr(observability, "OTLPSpanExporter", fail_exporter)

    with pytest.raises(RuntimeError, match="synthetic otlp init failure"):
        observability.configure_observability(app, configured)


def test_sentry_receives_release_environment_and_non_pii_tags(monkeypatch):
    configured = _settings(
        environment="development",
        sentry_dsn="https://public@example.invalid/1",
        sentry_traces_sample_rate=0.25,
    )
    app = FastAPI()
    init_kwargs: dict[str, object] = {}
    tags: list[tuple[str, str]] = []

    monkeypatch.setenv("RENOVA_GIT_SHA", "abc123")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:deadbeef")
    monkeypatch.setattr(
        observability.sentry_sdk,
        "init",
        lambda **kwargs: init_kwargs.update(kwargs),
    )
    monkeypatch.setattr(
        observability.sentry_sdk,
        "set_tag",
        lambda key, value: tags.append((key, value)),
    )

    runtime = observability.configure_observability(app, configured)

    assert runtime.sentry_enabled is True
    assert runtime.otel_enabled is False
    assert init_kwargs["environment"] == "development"
    assert init_kwargs["release"] == "abc123"
    assert init_kwargs["traces_sample_rate"] == 0.25
    assert init_kwargs["send_default_pii"] is False
    assert ("service", "renova-api") in tags
    assert ("artifact_digest", "sha256:deadbeef") in tags


def test_json_logs_include_release_environment_and_correlation_slot(monkeypatch):
    configured = _settings(environment="test", log_json=True)
    monkeypatch.setattr(logging_config, "settings", configured)
    monkeypatch.setenv("RENOVA_GIT_SHA", "release-sha")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:image")

    record = logging.LogRecord(
        name="renova.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="safe event",
        args=(),
        exc_info=None,
    )
    payload = json.loads(logging_config.JsonFormatter().format(record))

    assert payload["environment"] == "test"
    assert payload["service"] == "renova-api"
    assert payload["release"] == "release-sha"
    assert payload["artifact_digest"] == "sha256:image"
    assert payload["correlation_id"] is None
    assert "timestamp" in payload


def test_correlation_context_propagates_inbound_request_id_and_response_headers():
    app = FastAPI()
    app.add_middleware(CorrelationIdMiddleware)

    @app.get("/probe")
    async def probe():
        return {"correlation_id": current_correlation_id()}

    with TestClient(app) as client:
        response = client.get("/probe", headers={"X-Request-Id": "request-123"})

    assert response.status_code == 200
    assert response.json() == {"correlation_id": "request-123"}
    assert response.headers["X-Request-Id"] == "request-123"
    assert response.headers["X-Correlation-Id"] == "request-123"


def test_production_observability_guard_rejects_missing_or_unsafe_sinks():
    with pytest.raises(ValueError, match="SENTRY_DSN"):
        observability.validate_observability_configuration(
            _settings(
                environment="production",
                sentry_dsn=None,
                otel_exporter_otlp_endpoint="https://otel.example:4317",
                log_json=True,
            )
        )

    with pytest.raises(ValueError, match="localhost"):
        observability.validate_observability_configuration(
            _settings(
                environment="production",
                sentry_dsn="https://public@example.invalid/1",
                otel_exporter_otlp_endpoint="https://localhost:4317",
                log_json=True,
            )
        )
