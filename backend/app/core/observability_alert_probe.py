"""Synthetic staging-only observability drill.

Emitting telemetry is not evidence that an external backend ingested it or that
an on-call destination received an alert. The receipt returned by this module
therefore keeps external_delivery_confirmed=false by construction; operators
must attach external evidence using the documented drill contract.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import logging
from urllib.parse import urlparse
from uuid import UUID, uuid4

import sentry_sdk
from opentelemetry.trace import Status, StatusCode

from app.core.config import Settings, settings
from app.core.observability import (
    configure_worker_observability,
    release_digest,
    release_sha,
    validate_observability_configuration,
)

logger = logging.getLogger("renova.observability.alert_probe")


class AlertProbeConfigurationError(RuntimeError):
    """Raised when a drill could be unsafe or could produce ambiguous evidence."""


class AlertProbeEmissionError(RuntimeError):
    """Raised when one of the locally configured telemetry paths did not accept the probe."""


class SyntheticAlertProbeError(RuntimeError):
    """Intentional error used only to exercise the staging alert path."""


@dataclass(frozen=True)
class AlertProbeReceipt:
    probe_id: str
    emitted_at: str
    environment: str
    release: str
    artifact_digest: str
    sentry_event_id: str | None
    sentry_emitted: bool
    trace_emitted: bool
    metric_emitted: bool
    external_delivery_confirmed: bool = False

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _configured(value: str | None) -> bool:
    return bool((value or "").strip())


def _local_endpoint(value: str) -> bool:
    candidate = value.strip()
    parsed = urlparse(candidate if "://" in candidate else f"//{candidate}")
    return (parsed.hostname or "").lower() in {
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
    }


def _require_release_identity() -> tuple[str, str]:
    release = release_sha()
    digest = release_digest()
    errors: list[str] = []
    if release == "unknown":
        errors.append("RENOVA_GIT_SHA is required for an auditable staging drill")
    if digest == "unknown":
        errors.append("RENOVA_IMAGE_DIGEST is required for an auditable staging drill")
    if errors:
        raise AlertProbeConfigurationError("; ".join(errors))
    return release, digest


def validate_alert_probe_configuration(configured: Settings | None = None) -> tuple[str, str]:
    """Require a production-like external telemetry path in staging only."""
    current = configured or settings
    if current.normalized_environment != "staging":
        raise AlertProbeConfigurationError("observability alert probe is staging-only")

    try:
        validate_observability_configuration(current)
    except ValueError as exc:
        raise AlertProbeConfigurationError(str(exc)) from exc

    errors: list[str] = []
    if not _configured(current.sentry_dsn):
        errors.append("staging drill requires SENTRY_DSN")
    endpoint = (current.otel_exporter_otlp_endpoint or "").strip()
    if not endpoint:
        errors.append("staging drill requires OTEL_EXPORTER_OTLP_ENDPOINT")
    elif _local_endpoint(endpoint):
        errors.append("staging drill requires a non-local OTLP endpoint")
    if current.otel_exporter_otlp_insecure:
        errors.append("staging drill requires secure OTLP transport")
    if not current.log_json:
        errors.append("staging drill requires LOG_JSON=true")
    if errors:
        raise AlertProbeConfigurationError("; ".join(errors))

    return _require_release_identity()


def _canonical_probe_id(value: str | None) -> str:
    if value is None:
        return str(uuid4())
    try:
        return str(UUID(value))
    except (ValueError, AttributeError) as exc:
        raise AlertProbeConfigurationError("probe_id must be a UUID") from exc


def emit_staging_alert_probe(
    *,
    probe_id: str | None = None,
    configured: Settings | None = None,
) -> AlertProbeReceipt:
    """Emit one synthetic error, trace and metric into configured staging sinks."""
    current = configured or settings
    release, digest = validate_alert_probe_configuration(current)
    canonical_probe_id = _canonical_probe_id(probe_id)
    emitted_at = datetime.now(timezone.utc).isoformat()

    runtime = configure_worker_observability(current)
    sentry_event_id: str | None = None
    sentry_emitted = False
    trace_emitted = False
    metric_emitted = False
    synthetic_error = SyntheticAlertProbeError(
        f"Renova staging observability alert probe {canonical_probe_id}"
    )

    try:
        sentry_sdk.set_tag("renova.synthetic", "true")
        sentry_sdk.set_tag("renova.alert_probe_id", canonical_probe_id)
        sentry_sdk.set_tag("renova.release", release)
        sentry_sdk.set_tag("renova.artifact_digest", digest)
        event_id = sentry_sdk.capture_exception(synthetic_error)
        sentry_event_id = str(event_id) if event_id else None
        sentry_emitted = event_id is not None

        if runtime.tracer_provider is not None:
            tracer = runtime.tracer_provider.get_tracer("renova.observability.alert_probe")
            with tracer.start_as_current_span("renova.observability.alert_probe") as span:
                span.set_attribute("renova.synthetic", True)
                span.set_attribute("renova.alert_probe_id", canonical_probe_id)
                span.set_attribute("renova.release", release)
                span.set_attribute("renova.artifact_digest", digest)
                span.record_exception(synthetic_error)
                span.set_status(Status(StatusCode.ERROR, "synthetic staging alert drill"))
            trace_emitted = True

        if runtime.meter_provider is not None:
            meter = runtime.meter_provider.get_meter("renova.observability.alert_probe")
            counter = meter.create_counter(
                "renova.observability.alert_probe",
                unit="1",
                description="Synthetic staging observability alert probes emitted",
            )
            # Keep the UUID out of metric labels to avoid high-cardinality series.
            counter.add(
                1,
                {
                    "renova.synthetic": True,
                    "deployment.environment.name": current.normalized_environment,
                },
            )
            metric_emitted = True

        missing = [
            name
            for name, emitted in (
                ("sentry", sentry_emitted),
                ("trace", trace_emitted),
                ("metric", metric_emitted),
            )
            if not emitted
        ]
        if missing:
            raise AlertProbeEmissionError(
                "local observability probe emission incomplete: " + ",".join(missing)
            )

        logger.error(
            "staging observability alert probe emitted probe_id=%s external_delivery_confirmed=false",
            canonical_probe_id,
            extra={
                "event_kind": "observability_alert_probe",
                "probe_id": canonical_probe_id,
                "synthetic": True,
            },
        )
    finally:
        runtime.shutdown()

    return AlertProbeReceipt(
        probe_id=canonical_probe_id,
        emitted_at=emitted_at,
        environment=current.normalized_environment,
        release=release,
        artifact_digest=digest,
        sentry_event_id=sentry_event_id,
        sentry_emitted=sentry_emitted,
        trace_emitted=trace_emitted,
        metric_emitted=metric_emitted,
        external_delivery_confirmed=False,
    )
