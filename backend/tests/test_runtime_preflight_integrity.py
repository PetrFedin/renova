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
        "admin_user_ids": "admin-a",
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


def test_canonical_policy_accepts_staging_with_explicit_observability_warnings():
    configured = _working_settings(
        sentry_dsn=None,
        otel_exporter_otlp_endpoint=None,
        yookassa_shop_id=None,
        yookassa_secret=None,
        yookassa_webhook_secret=None,
    )

    policy = runtime_policy.validate_configured_runtime(configured)
    warnings = runtime_policy.configured_runtime_warnings(configured)

    assert policy.name == "staging"
    assert any("YOOKASSA_SHOP_ID" in warning for warning in warnings)
    assert any("SENTRY_DSN" in warning for warning in warnings)
    assert any("OTEL_EXPORTER_OTLP_ENDPOINT" in warning for warning in warnings)


def test_production_runtime_requires_external_observability_sinks():
    common = {
        "environment": "production",
        "public_base_url": "https://api.renova.example",
        "log_json": True,
        "otel_exporter_otlp_endpoint": "https://otel.renova.example:4317",
    }
    with pytest.raises(ValueError, match="SENTRY_DSN"):
        runtime_policy.validate_configured_runtime(
            _working_settings(**common, sentry_dsn=None)
        )

    with pytest.raises(ValueError, match="OTEL_EXPORTER_OTLP_ENDPOINT"):
        runtime_policy.validate_configured_runtime(
            _working_settings(
                environment="production",
                public_base_url="https://api.renova.example",
                log_json=True,
                sentry_dsn="https://public@example.invalid/1",
                otel_exporter_otlp_endpoint=None,
            )
        )


def test_production_runtime_rejects_insecure_observability_transport_and_plain_logs():
    with pytest.raises(ValueError, match="OTEL_EXPORTER_OTLP_INSECURE"):
        runtime_policy.validate_configured_runtime(
            _working_settings(
                environment="production",
                public_base_url="https://api.renova.example",
                sentry_dsn="https://public@example.invalid/1",
                otel_exporter_otlp_endpoint="otel.renova.example:4317",
                otel_exporter_otlp_insecure=True,
                log_json=True,
            )
        )

    with pytest.raises(ValueError, match="LOG_JSON"):
        runtime_policy.validate_configured_runtime(
            _working_settings(
                environment="production",
                public_base_url="https://api.renova.example",
                sentry_dsn="https://public@example.invalid/1",
                otel_exporter_otlp_endpoint="https://otel.renova.example:4317",
                otel_exporter_otlp_insecure=False,
                log_json=False,
            )
        )


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
        ({"admin_user_ids": ""}, "ADMIN_USER_IDS"),
        ({"admin_user_ids": "admin-a,,admin-b"}, "пустые элементы"),
        ({"admin_user_ids": "admin-a,admin-a"}, "повторяющиеся"),
        ({"allow_create_all": True}, "ALLOW_CREATE_ALL"),
        ({"allow_demo_seed": True}, "ALLOW_DEMO_SEED"),
    ],
)
def test_canonical_policy_rejects_each_working_runtime_violation(overrides, expected):
    configured = _working_settings(**overrides)

    with pytest.raises(ValueError, match=expected):
        runtime_policy.validate_configured_runtime(configured)


@pytest.mark.asyncio
async def test_static_preflight_is_network_free_and_reports_optional_warnings(
    monkeypatch,
):
    from app.services import storage_runtime

    configured = _working_settings()
    live_storage_called = False

    def must_not_call_live_storage() -> None:
        nonlocal live_storage_called
        live_storage_called = True
        raise AssertionError("static preflight called live storage")

    monkeypatch.setattr(runtime_preflight, "settings", configured)
    monkeypatch.setattr(
        storage_runtime,
        "validate_storage_runtime",
        must_not_call_live_storage,
    )

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
        "storage_configuration",
        "moy_nalog_oauth_configuration",
    ]
    assert live_storage_called is False
    assert any("YOOKASSA_SHOP_ID" in warning for warning in report.warnings)
    assert any("SENTRY_DSN" in warning for warning in report.warnings)
    assert any("OTEL_EXPORTER_OTLP_ENDPOINT" in warning for warning in report.warnings)


@pytest.mark.asyncio
async def test_enabled_moy_nalog_without_dedicated_keyring_fails_static_preflight(
    monkeypatch,
):
    from app.services import moy_nalog_oauth

    configured = _working_settings(
        moy_nalog_enabled=True,
        moy_nalog_client_id="moy-client",
        moy_nalog_client_secret="moy-client-secret",
        moy_nalog_authorize_url="https://auth.example.test/oauth",
        moy_nalog_token_url="https://auth.example.test/token",
        moy_nalog_redirect_uri="https://api-staging.renova.example/api/v1/fns/moy-nalog/oauth/callback",
        moy_nalog_token_encryption_keys="",
    )
    monkeypatch.setattr(runtime_preflight, "settings", configured)
    monkeypatch.setattr(moy_nalog_oauth, "settings", configured)

    report = await runtime_preflight.run_preflight(
        check_database=False,
        check_runtime_services=False,
    )

    checks = {check.name: check for check in report.checks}
    assert report.ok is False
    assert checks["moy_nalog_oauth_configuration"].ok is False
    assert "MOY_NALOG_TOKEN_ENCRYPTION_KEYS" in checks["moy_nalog_oauth_configuration"].detail
    assert configured.moy_nalog_client_secret not in checks["moy_nalog_oauth_configuration"].detail


@pytest.mark.asyncio
async def test_live_preflight_runs_storage_and_shared_auth_checks(monkeypatch):
    from app.services import otp_runtime, storage_runtime

    configured = _working_settings()
    calls: list[str] = []

    def storage_configuration() -> str:
        calls.append("storage_configuration")
        return "local"

    def storage_live() -> None:
        calls.append("storage_runtime")

    async def auth_live() -> None:
        calls.append("shared_auth_runtime")

    monkeypatch.setattr(runtime_preflight, "settings", configured)
    monkeypatch.setattr(
        storage_runtime,
        "validate_storage_configuration",
        storage_configuration,
    )
    monkeypatch.setattr(storage_runtime, "validate_storage_runtime", storage_live)
    monkeypatch.setattr(otp_runtime, "validate_otp_runtime", auth_live)

    report = await runtime_preflight.run_preflight(
        check_database=False,
        check_runtime_services=True,
    )

    assert report.ok is True
    assert calls == [
        "storage_configuration",
        "storage_runtime",
        "shared_auth_runtime",
    ]
    checks = {check.name: check for check in report.checks}
    assert checks["storage_configuration"].ok is True
    assert checks["storage_runtime"].ok is True
    assert checks["shared_auth_runtime"].ok is True
    assert checks["moy_nalog_oauth_configuration"].ok is True
    assert checks["moy_nalog_oauth_runtime"].ok is True


@pytest.mark.asyncio
async def test_storage_configuration_failure_is_reported_before_network(
    monkeypatch,
):
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
    assert checks["storage_configuration"].ok is False
    assert "partial_s3_configuration" in checks["storage_configuration"].detail
    assert configured.s3_access_key not in checks["storage_configuration"].detail
    assert "storage_runtime" not in checks


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
        moy_nalog_token_encryption_keys="oauth-keyring-primary-000000000000001,oauth-keyring-previous-0000000000002",
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
            configured.moy_nalog_token_encryption_keys or "",
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
    assert "await moy_nalog_oauth.validate_runtime()" in source
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
    staging_example = (_REPO_ROOT / "env.staging.example").read_text()

    assert "REDIS_URL=redis://redis:6379/0" in example
    assert "ADMIN_USER_IDS=" in example
    assert "TWILIO_SID=" in example
    assert "TWILIO_TOKEN=" in example
    assert "TWILIO_FROM=" in example
    assert "DOCUMENT_OCR_MODE=metadata" in example
    assert "python -m app.core.runtime_preflight" in example
    assert "SENTRY_DSN=\n" in example
    assert "OTEL_EXPORTER_OTLP_ENDPOINT=\n" in example
    assert "OTEL_EXPORTER_OTLP_INSECURE=false" in example
    assert "OTEL_SERVICE_NAME=renova-api" in example
    assert "Payments. Optional for API startup" in example
    assert "MOY_NALOG_TOKEN_ENCRYPTION_KEYS=" in example

    for required in (
        "DATABASE_URL=postgresql+asyncpg://renova:CHANGE_ME@managed-postgres:5432/renova",
        "REDIS_URL=redis://managed-redis:6379/0",
        "RENOVA_IMAGE_DIGEST=sha256:replace-with-promoted-ghcr-digest",
        "ghcr.io/petrfedin/renova-api@sha256:<DIGEST>",
        "alembic upgrade head",
        "ADMIN_USER_IDS=replace-with-real-contractor-user-id",
        "AUTH_ALLOW_HEADER_USER_ID=false",
        "ALLOW_CREATE_ALL=false",
        "ALLOW_DEMO_SEED=false",
        "TWILIO_SID=",
        "TWILIO_TOKEN=",
        "TWILIO_FROM=",
        "SENTRY_DSN=",
        "OTEL_EXPORTER_OTLP_ENDPOINT=",
        "OTEL_EXPORTER_OTLP_INSECURE=false",
        "OTEL_SERVICE_NAME=renova-api",
        "LOG_JSON=true",
        "MOY_NALOG_TOKEN_ENCRYPTION_KEYS=",
        "External staging release",
        "Do not deploy staging by cloning the repository",
    ):
        assert required in staging_example

    assert "poetry run uvicorn" not in staging_example
    assert "poetry install" not in staging_example
