from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core import runtime_policy, runtime_preflight


_REPO_ROOT = Path(__file__).resolve().parents[2]


def _working_settings(**overrides) -> Settings:
    values = {
        "environment": "staging",
        "database_url": "postgresql+asyncpg://renova:db-secret@db.internal/renova",
        "redis_url": "rediss://default:redis-secret@redis.internal:6380/0",
        "public_base_url": "https://api-staging.renova.example",
        "secret_key": "unique-staging-secret-key-32-characters",
        "auth_allow_header_user_id": False,
        "allow_create_all": False,
        "allow_demo_seed": False,
        "document_ocr_mode": "metadata",
        "twilio_sid": "AC00000000000000000000000000000000",
        "twilio_token": "twilio-provider-secret",
        "twilio_from": "+15005550006",
        "kontur_mode": "off",
        "goskey_mode": "off",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_canonical_policy_accepts_minimum_working_runtime_without_optional_vendors():
    configured = _working_settings(
        sentry_dsn=None,
        yookassa_shop_id=None,
        yookassa_secret=None,
        yookassa_webhook_secret=None,
    )

    policy = runtime_policy.validate_configured_runtime(configured)
    warnings = runtime_policy.configured_runtime_warnings(configured)

    assert policy.name == "staging"
    assert any("YOOKASSA_SHOP_ID" in warning for warning in warnings)
    assert not any("SENTRY" in warning.upper() for warning in warnings)


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"redis_url": None}, "REDIS_URL"),
        ({"twilio_sid": None}, "Twilio"),
        ({"twilio_token": None}, "Twilio"),
        ({"twilio_from": None}, "Twilio"),
        ({"database_url": "sqlite+aiosqlite:///./renova.db"}, "SQLite"),
        ({"public_base_url": "http://localhost:8100"}, "PUBLIC_BASE_URL"),
        ({"auth_allow_header_user_id": True}, "AUTH_ALLOW_HEADER_USER_ID"),
        ({"allow_create_all": True}, "ALLOW_CREATE_ALL"),
        ({"allow_demo_seed": True}, "ALLOW_DEMO_SEED"),
    ],
)
def test_canonical_policy_rejects_each_working_runtime_violation(overrides, expected):
    configured = _working_settings(**overrides)

    with pytest.raises(ValueError, match=expected):
        runtime_policy.validate_configured_runtime(configured)


@pytest.mark.asyncio
async def test_static_preflight_uses_canonical_policy_and_reports_optional_warnings(
    monkeypatch,
):
    configured = _working_settings()
    monkeypatch.setattr(runtime_preflight, "settings", configured)

    report = await runtime_preflight.run_preflight(
        check_database=False,
        check_runtime_services=False,
    )

    assert report.ok is True
    assert report.environment == "staging"
    assert [check.name for check in report.checks] == [
        "runtime_policy",
        "document_ocr_runtime",
        "esign_runtime",
        "storage_runtime",
    ]
    assert any("YOOKASSA_SHOP_ID" in warning for warning in report.warnings)


@pytest.mark.asyncio
async def test_storage_startup_failure_is_reported_before_deploy(monkeypatch):
    from app.services import storage_service

    configured = _working_settings(
        s3_endpoint="https://storage.example",
        s3_access_key="partial-access-key",
        s3_secret_key=None,
    )
    monkeypatch.setattr(runtime_preflight, "settings", configured)
    monkeypatch.setattr(storage_service, "settings", configured)

    report = await runtime_preflight.run_preflight(
        check_database=False,
        check_runtime_services=False,
    )

    checks = {check.name: check for check in report.checks}
    assert report.ok is False
    assert checks["runtime_policy"].ok is True
    assert checks["storage_runtime"].ok is False
    assert "partial_s3_configuration" in checks["storage_runtime"].detail
    assert configured.s3_access_key not in checks["storage_runtime"].detail


@pytest.mark.asyncio
async def test_invalid_policy_short_circuits_live_checks(monkeypatch):
    configured = _working_settings(redis_url=None)
    monkeypatch.setattr(runtime_preflight, "settings", configured)

    report = await runtime_preflight.run_preflight(
        check_database=True,
        check_runtime_services=True,
    )

    assert report.ok is False
    assert len(report.checks) == 1
    assert report.checks[0].name == "runtime_policy"
    assert report.checks[0].ok is False


@pytest.mark.asyncio
async def test_preflight_failure_redacts_all_configured_secrets(monkeypatch):
    configured = _working_settings(
        yookassa_secret="payment-secret",
        smtp_password="smtp-secret",
        s3_access_key="storage-key",
        s3_secret_key="storage-secret",
        moy_nalog_client_secret="oauth-secret",
        kontur_api_key="esign-key",
        esign_webhook_secret="esign-webhook-secret",
    )
    monkeypatch.setattr(runtime_preflight, "settings", configured)
    exposed = " ".join(
        [
            configured.secret_key,
            configured.database_url,
            configured.redis_url or "",
            configured.twilio_token or "",
            configured.yookassa_secret or "",
            configured.smtp_password or "",
            configured.s3_access_key or "",
            configured.s3_secret_key or "",
            configured.moy_nalog_client_secret or "",
            configured.kontur_api_key or "",
            configured.esign_webhook_secret or "",
        ]
    )

    check = await runtime_preflight._run_async_check(
        "synthetic",
        lambda: _raise_async(RuntimeError(exposed)),
        "unreachable",
    )

    assert check.ok is False
    assert "<redacted>" in check.detail
    for secret in exposed.split():
        assert secret not in check.detail


async def _raise_async(exc: Exception) -> None:
    raise exc


def test_fastapi_lifespan_uses_shared_runtime_policy_source():
    from app import main

    source = inspect.getsource(main.lifespan)
    assert "validate_configured_runtime()" in source
    assert "configured_runtime_warnings()" in source
    assert "validate_runtime_settings(" not in source
    assert "collect_warnings(" not in source


def test_ops_scripts_forbid_demo_header_fallbacks_and_suppressed_failures():
    env_smoke = (_REPO_ROOT / "scripts/staging-env-smoke.sh").read_text()
    report = (_REPO_ROOT / "scripts/staging-readiness-report.sh").read_text()
    probe = (_REPO_ROOT / "scripts/staging-credentials-probe.sh").read_text()

    for source in (env_smoke, report):
        assert "/api/v1/auth/demo" not in source
        assert '-H "X-User-Id:' not in source
        assert "|| true" not in source
        assert "TOKEN" in source
        assert "Authorization: Bearer" in source

    assert "app.core.runtime_preflight" in probe
    assert "need()" not in probe
    assert "SENTRY_DSN" not in probe
    assert "YOOKASSA_WEBHOOK_SECRET" not in probe


def test_environment_example_matches_working_runtime_contract():
    example = (_REPO_ROOT / "backend/.env.example").read_text()

    assert "REDIS_URL=redis://redis:6379/0" in example
    assert "TWILIO_SID=" in example
    assert "TWILIO_TOKEN=" in example
    assert "TWILIO_FROM=" in example
    assert "DOCUMENT_OCR_MODE=metadata" in example
    assert "python -m app.core.runtime_preflight" in example
    assert "SENTRY_DSN=\n" in example
    assert "Payments. Optional for API startup" in example
