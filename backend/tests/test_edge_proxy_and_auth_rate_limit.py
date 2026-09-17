"""Edge trust and credential-endpoint quota contracts.

Two separate defects are covered here:

1. `request.client.host` is the authoritative identity for the anonymous rate
   limit bucket, the YooKassa webhook IP allowlist and the audit trail. Behind a
   proxy it is the proxy address unless uvicorn is started with
   `--proxy-headers --forwarded-allow-ips`. Trust must be explicit and opt-in so
   a directly exposed runtime never accepts a spoofed `X-Forwarded-For`.

2. Credential endpoints previously shared the generic 120 rpm public-api bucket,
   which is far too permissive for OTP request/verify, login and refresh.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.environment import collect_warnings, validate_runtime_settings
from app.middleware.rate_limit import AUTH_PATH_PREFIXES, is_auth_path

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
        "twilio_sid": "AC00000000000000000000000000000000",
        "twilio_token": "twilio-provider-secret",
        "twilio_from": "+15005550006",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


# --- 1. explicit proxy trust ------------------------------------------------


def test_forwarded_allow_ips_defaults_to_not_trusting_proxy_headers():
    configured = _working_settings()

    assert configured.forwarded_allow_ips == ""
    assert configured.forwarded_allow_ip_list == ()
    assert configured.trusts_forwarded_headers is False


def test_forwarded_allow_ips_parses_into_an_ordered_entry_list():
    configured = _working_settings(forwarded_allow_ips="10.0.0.1, 10.0.0.2 ,10.0.0.3")

    assert configured.forwarded_allow_ip_list == ("10.0.0.1", "10.0.0.2", "10.0.0.3")
    assert configured.trusts_forwarded_headers is True


@pytest.mark.parametrize(
    "value",
    ["10.0.0.1,,10.0.0.2", "10.0.0.1\n10.0.0.2", "10.0.0.1\r", "x" * 513],
)
def test_malformed_forwarded_allow_ips_fails_startup(value: str):
    with pytest.raises(ValueError, match="FORWARDED_ALLOW_IPS"):
        validate_runtime_settings(
            environment="production",
            database_url="postgresql+asyncpg://renova:db-secret@db.internal/renova",
            public_base_url="https://api.renova.example",
            secret_key="unique-production-secret-key-32-characters",
            redis_url="rediss://default:redis-secret@redis.internal:6380/0",
            twilio_sid="AC00000000000000000000000000000000",
            twilio_token="twilio-provider-secret",
            twilio_from="+15005550006",
            forwarded_allow_ips=value,
        )


def test_deployed_runtime_warns_when_proxy_trust_is_unconfigured():
    warnings = collect_warnings(
        environment="production",
        database_url="postgresql+asyncpg://renova:db-secret@db.internal/renova",
        secret_key="unique-production-secret-key-32-characters",
        redis_url="rediss://default:redis-secret@redis.internal:6380/0",
        twilio_sid="AC00000000000000000000000000000000",
        twilio_token="twilio-provider-secret",
        twilio_from="+15005550006",
        forwarded_allow_ips="",
    )

    assert any("FORWARDED_ALLOW_IPS" in warning for warning in warnings)


def test_configured_proxy_trust_removes_the_warning():
    warnings = collect_warnings(
        environment="production",
        database_url="postgresql+asyncpg://renova:db-secret@db.internal/renova",
        secret_key="unique-production-secret-key-32-characters",
        redis_url="rediss://default:redis-secret@redis.internal:6380/0",
        twilio_sid="AC00000000000000000000000000000000",
        twilio_token="twilio-provider-secret",
        twilio_from="+15005550006",
        forwarded_allow_ips="10.0.0.0/8",
    )

    assert not any("FORWARDED_ALLOW_IPS" in warning for warning in warnings)


def test_api_launcher_enables_proxy_headers_only_when_trust_is_configured():
    launcher = (_REPO_ROOT / "backend/docker/renova-api").read_text(encoding="utf-8")

    assert "FORWARDED_ALLOW_IPS" in launcher
    assert "--proxy-headers" in launcher
    assert "--forwarded-allow-ips" in launcher
    # The flags must sit behind the explicit guard, never unconditionally.
    guard_index = launcher.index('if [ -n "${FORWARDED_ALLOW_IPS:-}" ]')
    assert launcher.index("--proxy-headers") > guard_index


# --- 2. dedicated credential quota ------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/sms/request",
        "/api/v1/auth/sms/verify",
    ],
)
def test_credential_paths_are_recognised(path: str):
    assert is_auth_path(path) is True


@pytest.mark.parametrize(
    "path",
    ["/api/v1/projects", "/api/v1/authors", "/health", "/ready", "/api/v1/payments"],
)
def test_non_credential_paths_are_not_rate_limited_as_auth(path: str):
    assert is_auth_path(path) is False


def test_auth_prefix_covers_the_otp_router_mounted_under_it():
    assert AUTH_PATH_PREFIXES == ("/api/v1/auth",)


def test_auth_quota_is_strictly_tighter_than_the_generic_public_quota():
    configured = _working_settings()

    assert configured.auth_rate_limit_rpm < configured.rate_limit_rpm


@pytest.mark.parametrize("value", [0, 601])
def test_auth_quota_rejects_out_of_range_values(value: int):
    with pytest.raises(ValueError):
        _working_settings(auth_rate_limit_rpm=value)
