"""Production observability bootstrap for errors, traces and metrics.

The runtime dependencies in this module are intentionally direct imports. If the
reviewed lockfile/image does not contain observability support, process import
must fail instead of silently starting without telemetry.
"""
from __future__ import annotations

from dataclasses import dataclass
import logging
import os
from urllib.parse import urlparse

from fastapi import FastAPI
import sentry_sdk
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

from app.core.config import Settings, settings

logger = logging.getLogger(__name__)


def release_sha() -> str:
    value = (os.getenv("RENOVA_GIT_SHA") or "unknown").strip()
    return value or "unknown"


def release_digest() -> str:
    value = (os.getenv("RENOVA_IMAGE_DIGEST") or "unknown").strip()
    return value or "unknown"


def _configured(value: str | None) -> bool:
    return bool((value or "").strip())


def _local_endpoint(value: str) -> bool:
    candidate = value.strip()
    parsed = urlparse(candidate if "://" in candidate else f"//{candidate}")
    host = (parsed.hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def validate_observability_configuration(configured: Settings | None = None) -> None:
    """Reject observability settings that would make production silently blind."""
    current = configured or settings
    environment = current.normalized_environment
    errors: list[str] = []

    for name, value in (
        ("SENTRY_TRACES_SAMPLE_RATE", current.sentry_traces_sample_rate),
        ("OTEL_TRACES_SAMPLE_RATE", current.otel_traces_sample_rate),
    ):
        if not 0.0 <= float(value) <= 1.0:
            errors.append(f"{name} должен быть в диапазоне 0..1")

    if not (current.otel_service_name or "").strip():
        errors.append("OTEL_SERVICE_NAME не может быть пустым")

    if environment == "production":
        if not _configured(current.sentry_dsn):
            errors.append("production: SENTRY_DSN обязателен")
        if not _configured(current.otel_exporter_otlp_endpoint):
            errors.append("production: OTEL_EXPORTER_OTLP_ENDPOINT обязателен")
        elif _local_endpoint(current.otel_exporter_otlp_endpoint or ""):
            errors.append("production: OTEL_EXPORTER_OTLP_ENDPOINT не может быть localhost")
        if current.otel_exporter_otlp_insecure:
            errors.append("production: OTEL_EXPORTER_OTLP_INSECURE должен быть false")
        if not current.log_json:
            errors.append("production: LOG_JSON должен быть true")

    if errors:
        raise ValueError("Observability guard failed:\n- " + "\n- ".join(errors))


def observability_warnings(configured: Settings | None = None) -> tuple[str, ...]:
    """Expose staging gaps without falsely claiming an external on-call path."""
    current = configured or settings
    if current.normalized_environment != "staging":
        return ()

    warnings: list[str] = []
    if not _configured(current.sentry_dsn):
        warnings.append("staging: SENTRY_DSN не настроен; external error sink не подтвержден")
    if not _configured(current.otel_exporter_otlp_endpoint):
        warnings.append(
            "staging: OTEL_EXPORTER_OTLP_ENDPOINT не настроен; external telemetry sink не подтвержден"
        )
    if not current.log_json:
        warnings.append("staging: LOG_JSON=false; structured log ingestion не подтвержден")
    return tuple(warnings)


@dataclass
class ObservabilityRuntime:
    sentry_enabled: bool = False
    otel_enabled: bool = False
    tracer_provider: TracerProvider | None = None
    meter_provider: MeterProvider | None = None

    def shutdown(self) -> None:
        """Flush provider buffers during graceful process shutdown."""
        if self.meter_provider is not None:
            self.meter_provider.shutdown()
        if self.tracer_provider is not None:
            self.tracer_provider.shutdown()
        if self.sentry_enabled:
            sentry_sdk.flush(timeout=2)


def _resource(current: Settings) -> Resource:
    return Resource.create(
        {
            "service.name": current.otel_service_name.strip(),
            "service.version": release_sha(),
            "deployment.environment.name": current.normalized_environment,
            "container.image.id": release_digest(),
        }
    )


def _configure_sentry(current: Settings) -> bool:
    dsn = (current.sentry_dsn or "").strip()
    if not dsn:
        return False

    release = release_sha()
    sentry_sdk.init(
        dsn=dsn,
        environment=current.normalized_environment,
        release=None if release == "unknown" else release,
        traces_sample_rate=float(current.sentry_traces_sample_rate),
        send_default_pii=False,
    )
    sentry_sdk.set_tag("service", current.otel_service_name.strip())
    sentry_sdk.set_tag("artifact_digest", release_digest())
    return True


def _server_request_hook(span, scope: dict) -> None:
    """Attach the already-sanitized request correlation id to server spans."""
    if not span or not span.is_recording():
        return
    state = scope.get("state") or {}
    correlation_id = state.get("correlation_id") if isinstance(state, dict) else None
    if correlation_id:
        span.set_attribute("renova.correlation_id", str(correlation_id))


def _build_otel_providers(
    current: Settings,
) -> tuple[TracerProvider | None, MeterProvider | None]:
    endpoint = (current.otel_exporter_otlp_endpoint or "").strip()
    if not endpoint:
        return None, None

    insecure = bool(current.otel_exporter_otlp_insecure)
    resource = _resource(current)

    tracer_provider = TracerProvider(
        resource=resource,
        sampler=ParentBased(TraceIdRatioBased(float(current.otel_traces_sample_rate))),
    )
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, insecure=insecure))
    )

    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=endpoint, insecure=insecure)
    )
    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    return tracer_provider, meter_provider


def _configure_otel(
    app: FastAPI,
    current: Settings,
) -> tuple[TracerProvider | None, MeterProvider | None]:
    tracer_provider, meter_provider = _build_otel_providers(current)
    if tracer_provider is None or meter_provider is None:
        return tracer_provider, meter_provider

    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=tracer_provider,
        meter_provider=meter_provider,
        server_request_hook=_server_request_hook,
    )
    return tracer_provider, meter_provider


def _runtime(
    *,
    sentry_enabled: bool,
    tracer_provider: TracerProvider | None,
    meter_provider: MeterProvider | None,
) -> ObservabilityRuntime:
    return ObservabilityRuntime(
        sentry_enabled=sentry_enabled,
        otel_enabled=tracer_provider is not None,
        tracer_provider=tracer_provider,
        meter_provider=meter_provider,
    )


def configure_observability(
    app: FastAPI,
    configured: Settings | None = None,
) -> ObservabilityRuntime:
    """Configure reviewed API telemetry sinks once; configured failures are fatal."""
    current = configured or settings
    validate_observability_configuration(current)

    sentry_enabled = _configure_sentry(current)
    tracer_provider, meter_provider = _configure_otel(app, current)
    runtime = _runtime(
        sentry_enabled=sentry_enabled,
        tracer_provider=tracer_provider,
        meter_provider=meter_provider,
    )
    app.state.observability_runtime = runtime
    logger.info(
        "observability configured (service=%s environment=%s sentry=%s otel=%s release=%s artifact_digest=%s)",
        current.otel_service_name.strip(),
        current.normalized_environment,
        runtime.sentry_enabled,
        runtime.otel_enabled,
        release_sha(),
        release_digest(),
    )
    return runtime


def configure_worker_observability(
    configured: Settings | None = None,
) -> ObservabilityRuntime:
    """Configure the same reviewed sinks without FastAPI HTTP instrumentation."""
    current = configured or settings
    validate_observability_configuration(current)
    sentry_enabled = _configure_sentry(current)
    tracer_provider, meter_provider = _build_otel_providers(current)
    runtime = _runtime(
        sentry_enabled=sentry_enabled,
        tracer_provider=tracer_provider,
        meter_provider=meter_provider,
    )
    logger.info(
        "worker observability configured (service=%s environment=%s sentry=%s otel=%s release=%s artifact_digest=%s)",
        current.otel_service_name.strip(),
        current.normalized_environment,
        runtime.sentry_enabled,
        runtime.otel_enabled,
        release_sha(),
        release_digest(),
    )
    return runtime
