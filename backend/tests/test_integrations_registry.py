"""Реестр интеграций: честные статусы, отсутствие утечек, fail-closed production (C9/C10/C11)."""
from __future__ import annotations

import inspect
import json

import pytest

from app.api.v1 import admin_integrations
from app.core import runtime_policy
from app.core.config import Settings
from app.services.integrations import registry

SECRETS = {
    "yookassa_secret": "yk-secret-VALUE-1",
    "yookassa_webhook_secret": "yk-webhook-VALUE-2",
    "twilio_token": "tw-token-VALUE-3",
    "s3_secret_key": "s3-secret-VALUE-4",
    "smtp_password": "smtp-pass-VALUE-5",
    "sentry_dsn": "https://VALUE6@sentry.example/1",
    "kontur_api_key": "kontur-VALUE-7",
}


def _s(**overrides) -> Settings:
    base = {"environment": "development"}
    base.update(overrides)
    return Settings(_env_file=None, **base)


def _working(**overrides) -> Settings:
    values = {
        "environment": "production",
        "database_url": "postgresql+asyncpg://renova:db-secret@db.internal/renova",
        "redis_url": "rediss://default:redis-secret@redis.internal:6380/0",
        "public_base_url": "https://api.renova.example",
        "secret_key": "unique-production-secret-key-32-characters",
        "auth_allow_header_user_id": False,
        "admin_user_ids": "admin-a",
        "allow_create_all": False,
        "allow_demo_seed": False,
        "twilio_sid": "AC00000000000000000000000000000000",
        "twilio_token": "twilio-provider-secret",
        "twilio_from": "+15005550006",
        "log_json": True,
        "sentry_dsn": "https://key@sentry.example/1",
        "otel_exporter_otlp_endpoint": "https://otel.renova.example:4317",
        "s3_endpoint": "https://s3.example",
        "s3_access_key": "access",
        "s3_secret_key": "secret",
        "forwarded_allow_ips": "10.0.0.5",
        "cors_allowed_origins": "https://app.renova.example",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _by_key(settings_obj: Settings) -> dict:
    return {i["key"]: i for i in registry.status_report(settings_obj)["integrations"]}


def test_defaults_are_honest_stubs_never_configured():
    items = _by_key(_s())
    for key in ("payments", "npd_moy_nalog", "fns_receipts", "sms_otp", "esign", "storage", "email", "sentry", "otlp"):
        assert items[key]["state"] == "stub", key
        assert items[key]["configured"] is False
        assert items[key]["stub"] is True
        assert items[key]["live_verified"] is False
    assert items["payments"]["missing_keys"] == ["YOOKASSA_SHOP_ID", "YOOKASSA_SECRET", "YOOKASSA_WEBHOOK_SECRET"]
    assert items["storage"]["provider"] == "local_disk"
    # push: бэкенду настраивать нечего, успех не изображается
    assert items["push"]["state"] == "external_only"
    assert items["push"]["configured"] is False
    assert items["push"]["manual_prerequisites"]


def test_partial_then_configured_selected_by_settings():
    partial = _by_key(_s(yookassa_shop_id="123"))["payments"]
    assert partial["state"] == "partial"
    assert partial["provider"] == "yookassa"
    assert partial["missing_keys"] == ["YOOKASSA_SECRET", "YOOKASSA_WEBHOOK_SECRET"]

    full = _by_key(_s(yookassa_shop_id="123", yookassa_secret="s", yookassa_webhook_secret="w"))["payments"]
    assert full["state"] == "configured" and full["configured"] is True and full["missing_keys"] == []

    kontur = _by_key(_s(kontur_mode="sandbox"))["esign"]
    assert kontur["provider"] == "kontur" and kontur["state"] == "partial"
    assert "KONTUR_API_KEY" in kontur["missing_keys"]
    assert _by_key(_s(s3_endpoint="https://s3.x", s3_access_key="a"))["storage"]["missing_keys"] == ["S3_SECRET_KEY"]


def test_report_never_leaks_secret_values():
    cfg = _s(
        yookassa_shop_id="shop-1", yookassa_secret=SECRETS["yookassa_secret"],
        yookassa_webhook_secret=SECRETS["yookassa_webhook_secret"],
        twilio_sid="ACsid", twilio_token=SECRETS["twilio_token"], twilio_from="+15005550006",
        s3_endpoint="https://s3.x", s3_access_key="AKIA-ACCESS", s3_secret_key=SECRETS["s3_secret_key"],
        smtp_host="smtp.x", smtp_user="u", smtp_password=SECRETS["smtp_password"],
        sentry_dsn=SECRETS["sentry_dsn"], kontur_mode="live", kontur_api_key=SECRETS["kontur_api_key"],
    )
    blob = json.dumps(registry.status_report(cfg))
    for value in [*SECRETS.values(), "AKIA-ACCESS", "ACsid", "shop-1"]:
        assert value not in blob


def test_last_check_is_recorded_and_previous_returned():
    registry.status_report(_s())
    second = registry.status_report(_s())
    item = second["integrations"][0]
    assert item["last_check"]["kind"] == "configuration"
    assert item["previous_check"] is not None


def test_production_requires_s3_but_staging_only_warns():
    with pytest.raises(ValueError, match="storage"):
        runtime_policy.validate_configured_runtime(_working(s3_endpoint=None, s3_access_key=None, s3_secret_key=None))
    with pytest.raises(ValueError, match="S3_SECRET_KEY"):
        runtime_policy.validate_configured_runtime(_working(s3_secret_key=None))
    assert runtime_policy.validate_configured_runtime(_working()).name == "production"

    staging = _working(environment="staging", s3_endpoint=None, s3_access_key=None, s3_secret_key=None)
    assert runtime_policy.validate_configured_runtime(staging).name == "staging"
    assert any("storage" in w for w in runtime_policy.configured_runtime_warnings(staging))


def test_cors_wildcard_forbidden_in_working_environments():
    with pytest.raises(ValueError, match="CORS_ALLOWED_ORIGINS"):
        runtime_policy.validate_configured_runtime(_working(cors_allowed_origins="*"))
    with pytest.raises(ValueError, match="CORS_ALLOWED_ORIGINS"):
        runtime_policy.validate_configured_runtime(
            _working(environment="staging", cors_allowed_origins="https://a.example,*")
        )
    # development остаётся свободным
    assert registry.cors_findings(_s(cors_allowed_origins="*")) == []


def test_forwarded_allow_ips_required_in_production(monkeypatch):
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    with pytest.raises(ValueError, match="FORWARDED_ALLOW_IPS"):
        runtime_policy.validate_configured_runtime(_working(forwarded_allow_ips=None))
    staging = _working(environment="staging", forwarded_allow_ips=None)
    runtime_policy.validate_configured_runtime(staging)
    assert any("FORWARDED_ALLOW_IPS" in w for w in runtime_policy.configured_runtime_warnings(staging))
    star = _working(forwarded_allow_ips="*")
    runtime_policy.validate_configured_runtime(star)
    assert any("FORWARDED_ALLOW_IPS=*" in w for w in runtime_policy.configured_runtime_warnings(star))


def test_integrations_strict_makes_payments_fail_closed_in_production():
    relaxed = _working()
    assert runtime_policy.validate_configured_runtime(relaxed).name == "production"
    with pytest.raises(ValueError, match="payments"):
        runtime_policy.validate_configured_runtime(_working(integrations_strict=True))
    ok = _working(
        integrations_strict=True, yookassa_shop_id="1", yookassa_secret="s", yookassa_webhook_secret="w",
    )
    assert runtime_policy.validate_configured_runtime(ok).name == "production"


def test_status_endpoint_is_admin_only_and_returns_report(monkeypatch):
    source = inspect.getsource(admin_integrations)
    assert source.count("Depends(require_admin_user)") == 1
    assert "get_current_user" not in source

    from app.api.v1 import admin

    from fastapi.routing import iter_route_contexts

    paths = {r.path for r in iter_route_contexts(admin.router.routes)}
    assert "/admin/integrations/status" in paths

    import asyncio

    report = asyncio.run(admin_integrations.integrations_status(user=object()))
    assert report["verification"] == "configuration_only"
    assert {i["key"] for i in report["integrations"]} >= {"payments", "storage", "sms_otp", "push", "sentry", "otlp"}
    assert report["summary"]["total"] == len(report["integrations"])
