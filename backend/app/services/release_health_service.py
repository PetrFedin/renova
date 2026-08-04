"""Truthful release and observability status for operational health APIs.

Configuration is not telemetry.  This module never fabricates crash-free rates,
session counts, release versions, or commit identities.  Metrics are nullable
until a real metrics backend is wired and queried successfully.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings


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


def sentry_runtime_snapshot() -> dict[str, Any]:
    """Report configuration/runtime state without pretending it is Sentry data."""
    configured = bool((settings.sentry_dsn or "").strip())
    sdk_importable = False
    sdk_active = False
    runtime_error: str | None = None

    if configured:
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

    if not configured:
        status = "not_configured"
        reason = "sentry_dsn_not_configured"
    elif not sdk_importable:
        status = "degraded"
        reason = "sentry_sdk_unavailable"
    elif not sdk_active:
        status = "degraded"
        reason = "sentry_sdk_not_active"
    else:
        status = "active"
        reason = "metrics_api_not_configured"

    return {
        "status": status,
        "configured": configured,
        "sdk_importable": sdk_importable,
        "sdk_active": sdk_active,
        "runtime_error": runtime_error,
        "metrics": {
            "source": "unavailable",
            "available": False,
            "reason": reason,
            "crash_free_rate": None,
            "sessions": None,
        },
    }


def truthful_release_snapshot() -> dict[str, Any]:
    return {
        "contract_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "release": release_identity(),
        "observability": sentry_runtime_snapshot(),
    }
