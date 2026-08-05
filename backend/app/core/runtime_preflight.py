"""Canonical deployment preflight for Renova working environments.

The command deliberately reuses the same policy and runtime validators as the
FastAPI lifespan. It emits only non-secret status metadata and exits non-zero
when a deployment would fail startup or has an unusable administrator allowlist.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict, dataclass
import json
import sys
from typing import Awaitable, Callable

from app.core.config import settings
from app.core.runtime_policy import configured_runtime_warnings, validate_configured_runtime


@dataclass(frozen=True)
class PreflightCheck:
    name: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class PreflightReport:
    environment: str
    ok: bool
    checks: tuple[PreflightCheck, ...]
    warnings: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "environment": self.environment,
            "ok": self.ok,
            "checks": [asdict(check) for check in self.checks],
            "warnings": list(self.warnings),
        }


def _redacted_error(exc: Exception) -> str:
    """Keep diagnostics actionable without echoing configuration secrets/DSNs."""
    detail = str(exc)
    sensitive_values = (
        settings.secret_key,
        settings.database_url,
        settings.redis_url,
        settings.twilio_sid,
        settings.twilio_token,
        settings.yookassa_secret,
        settings.yookassa_webhook_secret,
        settings.smtp_password,
        settings.s3_access_key,
        settings.s3_secret_key,
        settings.moy_nalog_client_secret,
        settings.kontur_api_key,
        settings.esign_webhook_secret,
        *settings.admin_identity_config.configured_ids,
    )
    for value in sensitive_values:
        candidate = str(value or "").strip()
        if candidate:
            detail = detail.replace(candidate, "<redacted>")
    detail = detail.replace("\r", " ").replace("\n", " | ")
    return f"{type(exc).__name__}: {detail[:1000]}"


async def _run_async_check(
    name: str,
    operation: Callable[[], Awaitable[object]],
    success_detail: str,
) -> PreflightCheck:
    try:
        await operation()
    except Exception as exc:
        return PreflightCheck(
            name=name,
            ok=False,
            detail=_redacted_error(exc),
        )
    return PreflightCheck(name=name, ok=True, detail=success_detail)


def _run_sync_check(
    name: str,
    operation: Callable[[], object],
    success_detail: str,
) -> PreflightCheck:
    try:
        operation()
    except Exception as exc:
        return PreflightCheck(
            name=name,
            ok=False,
            detail=_redacted_error(exc),
        )
    return PreflightCheck(name=name, ok=True, detail=success_detail)


async def run_preflight(
    *,
    check_database: bool = True,
    check_runtime_services: bool = True,
) -> PreflightReport:
    """Evaluate all requested deployment gates without starting workers."""
    checks: list[PreflightCheck] = []

    policy_check = _run_sync_check(
        "runtime_policy",
        lambda: validate_configured_runtime(settings),
        "configured environment policy accepted",
    )
    checks.append(policy_check)

    # Additional validators depend on policy-safe configuration. Avoid cascaded
    # network/errors when the configuration itself is already invalid.
    if policy_check.ok:
        from app.services.document_ocr_runtime import validate_document_ocr_runtime
        from app.services.esign.runtime import validate_esign_runtime
        from app.services.storage_runtime import (
            validate_storage_configuration,
            validate_storage_runtime,
        )

        checks.append(
            _run_sync_check(
                "document_ocr_runtime",
                validate_document_ocr_runtime,
                f"mode={settings.document_ocr_mode}",
            )
        )
        checks.append(
            _run_sync_check(
                "esign_runtime",
                validate_esign_runtime,
                f"kontur_mode={settings.kontur_mode}; goskey_mode={settings.goskey_mode}",
            )
        )
        checks.append(
            _run_sync_check(
                "storage_configuration",
                validate_storage_configuration,
                "storage mode configuration accepted",
            )
        )

        if check_runtime_services:
            from app.services.otp_runtime import validate_otp_runtime

            checks.append(
                _run_sync_check(
                    "storage_runtime",
                    validate_storage_runtime,
                    "storage backend reachable",
                )
            )
            checks.append(
                await _run_async_check(
                    "shared_auth_runtime",
                    validate_otp_runtime,
                    "shared OTP/OAuth runtime reachable",
                )
            )

        if check_database:
            from app.db.migration_guard import assert_database_at_head
            from app.db.session import SessionLocal, engine
            from app.services.admin_identity_service import assert_admin_identities

            async def database_ready() -> None:
                await assert_database_at_head(engine)

            database_check = await _run_async_check(
                "database_revision",
                database_ready,
                "database matches bundled Alembic head",
            )
            checks.append(database_check)

            # Query users only after schema compatibility is proven. This is a
            # deployment gate, not a startup dependency, so initial bootstrap
            # can create the first real contractor before release verification.
            if database_check.ok:
                admin_count = settings.admin_identity_config.configured_count

                async def admin_identity_ready() -> None:
                    async with SessionLocal() as db:
                        await assert_admin_identities(
                            db,
                            settings.admin_identity_config.configured_ids,
                        )

                checks.append(
                    await _run_async_check(
                        "admin_identity_database",
                        admin_identity_ready,
                        f"configured_count={admin_count}; all identities are contractors",
                    )
                )

    warnings = tuple(str(item) for item in configured_runtime_warnings(settings))
    return PreflightReport(
        environment=settings.normalized_environment,
        ok=all(check.ok for check in checks),
        checks=tuple(checks),
        warnings=warnings,
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate Renova runtime policy and deployment dependencies.",
    )
    parser.add_argument(
        "--skip-database",
        action="store_true",
        help="Skip live Alembic revision and admin identity verification.",
    )
    parser.add_argument(
        "--skip-runtime-services",
        action="store_true",
        help="Skip live storage, Redis, and OAuth runtime validation.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a single JSON document suitable for automation.",
    )
    return parser.parse_args()


def _render_text(report: PreflightReport) -> str:
    lines = [
        f"runtime preflight: environment={report.environment} ok={str(report.ok).lower()}"
    ]
    for check in report.checks:
        state = "OK" if check.ok else "FAIL"
        lines.append(f"{state} {check.name}: {check.detail}")
    for warning in report.warnings:
        lines.append(f"WARN {warning}")
    return "\n".join(lines)


async def _command(arguments: argparse.Namespace) -> int:
    report = await run_preflight(
        check_database=not arguments.skip_database,
        check_runtime_services=not arguments.skip_runtime_services,
    )
    if arguments.json:
        print(json.dumps(report.to_dict(), ensure_ascii=False, sort_keys=True))
    else:
        stream = sys.stdout if report.ok else sys.stderr
        print(_render_text(report), file=stream)
    return 0 if report.ok else 2


if __name__ == "__main__":
    args = _parse_args()
    raise SystemExit(asyncio.run(_command(args)))
