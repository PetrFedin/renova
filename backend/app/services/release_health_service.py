"""Truthful release and observability status for operational health APIs.

Configuration is not telemetry.  SDK initialization is not external ingestion.
This module never fabricates crash-free rates, session counts, release versions,
collector delivery, or alert delivery. External confirmations remain false until
a deployment drill records real evidence outside the repository.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.core.observability import release_digest, release_sha


def _clean_env(*names: str) -> tuple[str | None, str | None]:
    for name in names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value, name
    return None, None


def release_identity() -> dict[str, Any]:
    """Return deployment-provided identity, never a guessed application version."""
    version, version_source = _clean_env(
        "RELEASE_VERSION",
        "APP_VERSION",
        "RENDER_GIT_COMMIT",
    )
    commit_sha, commit_source = _clean_env(
        "RENOVA_GIT_SHA",
        "RELEASE_COMMIT_SHA",
        "GIT_SHA",
        "RENDER_GIT_COMMIT",
        "RAILWAY_GIT_COMMIT_SHA",
    )
    if commit_sha:
        commit_sha = commit_sha[:64]
    return {
        "version": version,
        "version_source": version_source,
        "commit_sha": commit_sha,
        "commit_source": commit_source,
        "identified": bool(version or commit_sha),
    }


def observability_runtime_snapshot() -> dict[str, Any]:
    """Separate local runtime state from unproven external delivery."""
    sentry_configured = bool((settings.sentry_dsn or "").strip())
    otel_configured = bool((settings.otel_exporter_otlp_endpoint or "").strip())
    sdk_importable = False
    sdk_active = False
    runtime_error: str | None = None

    if sentry_configured:
        try:
            import sentry_sdk

            sdk_importable = True
            get_client = getattr(sentry_sdk, "get_client", None)
            if callable(get_client):
                client = get_client()
                is_active = getattr(client, "is_active", None)
                sdk_active = bool(is_active()) if callable(is_active) else bool(client)
            else:
                hub = getattr(sentry_sdk, "Hub", None)
                current = getattr(hub, "current", None) if hub else None
                sdk_active = bool(getattr(current, "client", None))
        except Exception as exc:  # health endpoint must remain available
            runtime_error = type(exc).__name__

    if not sentry_configured and not otel_configured:
        status = "not_configured"
    elif runtime_error or (sentry_configured and not sdk_active):
        status = "degraded"
    else:
        # A configured/active SDK does not prove that an external backend received
        # an event, trace, metric, or alert. Keep the distinction explicit.
        status = "configured_unverified"

    if not sentry_configured:
        metrics_reason = "sentry_dsn_not_configured"
    elif not sdk_importable:
        metrics_reason = "sentry_sdk_unavailable"
    elif not sdk_active:
        metrics_reason = "sentry_sdk_not_active"
    else:
        metrics_reason = "metrics_api_not_configured"

    return {
        "status": status,
        # Backward-compatible Sentry summary fields.
        "configured": sentry_configured,
        "sdk_importable": sdk_importable,
        "sdk_active": sdk_active,
        "runtime_error": runtime_error,
        "sentry": {
            "configured": sentry_configured,
            "sdk_active": sdk_active,
            "external_ingestion_confirmed": False,
        },
        "otel": {
            "configured": otel_configured,
            "service_name": settings.otel_service_name,
            "secure_transport_required": settings.normalized_environment == "production",
            "insecure_transport": bool(settings.otel_exporter_otlp_insecure),
            "external_ingestion_confirmed": False,
        },
        "structured_logs": {
            "enabled": bool(settings.log_json),
            "external_ingestion_confirmed": False,
        },
        "artifact": {
            "git_sha": None if release_sha() == "unknown" else release_sha(),
            "image_digest": None if release_digest() == "unknown" else release_digest(),
        },
        "external_confirmations": {
            "sentry_ingestion": False,
            "otlp_ingestion": False,
            "structured_log_ingestion": False,
            "alert_delivery": False,
        },
        "metrics": {
            "source": "unavailable",
            "available": False,
            "reason": metrics_reason,
            "crash_free_rate": None,
            "sessions": None,
        },
    }


def sentry_runtime_snapshot() -> dict[str, Any]:
    """Compatibility alias for callers that used the former Sentry-only helper."""
    return observability_runtime_snapshot()


def truthful_release_snapshot() -> dict[str, Any]:
    return {
        "contract_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "release": release_identity(),
        "observability": observability_runtime_snapshot(),
    }
