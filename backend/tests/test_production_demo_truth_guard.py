from pathlib import Path

import pytest

from app.core.environment import resolve_policy_flag, validate_runtime_settings


PRODUCTION_SETTINGS = {
    "environment": "production",
    "database_url": "postgresql+asyncpg://renova:password@db.example.com/renova",
    "public_base_url": "https://api.example.com",
    "secret_key": "production-unique-secret-32-characters",
    "redis_url": "rediss://redis.example.com:6379/0",
    "twilio_sid": "synthetic-account-id-for-tests",
    "twilio_token": "synthetic-provider-token-for-tests",
    "twilio_from": "+74951234567",
}

STAGING_SETTINGS = {
    **PRODUCTION_SETTINGS,
    "environment": "staging",
}


def test_production_rejects_demo_seed_override():
    with pytest.raises(ValueError, match="ALLOW_DEMO_SEED=true"):
        validate_runtime_settings(
            **PRODUCTION_SETTINGS,
            allow_demo_seed=True,
        )


def test_production_rejects_create_all_override():
    with pytest.raises(ValueError, match="ALLOW_CREATE_ALL=true"):
        validate_runtime_settings(
            **PRODUCTION_SETTINGS,
            allow_create_all=True,
        )


def test_staging_rejects_both_forbidden_overrides_in_one_failure():
    with pytest.raises(ValueError) as error:
        validate_runtime_settings(
            **STAGING_SETTINGS,
            allow_create_all=True,
            allow_demo_seed=True,
        )

    message = str(error.value)
    assert "ALLOW_CREATE_ALL=true" in message
    assert "ALLOW_DEMO_SEED=true" in message


def test_production_explicit_false_is_valid():
    policy = validate_runtime_settings(
        **PRODUCTION_SETTINGS,
        allow_create_all=False,
        allow_demo_seed=False,
    )
    assert policy.name == "production"


def test_development_may_enable_or_disable_local_capabilities():
    development = {
        "environment": "development",
        "database_url": "sqlite+aiosqlite:///./renova.db",
        "public_base_url": "http://127.0.0.1:8100",
        "secret_key": "dev-secret-change-me",
    }
    validate_runtime_settings(
        **development,
        allow_create_all=True,
        allow_demo_seed=True,
    )
    validate_runtime_settings(
        **development,
        allow_create_all=False,
        allow_demo_seed=False,
    )


def test_override_can_disable_but_never_enable_forbidden_capability():
    assert resolve_policy_flag(policy_allows=True, override=None) is True
    assert resolve_policy_flag(policy_allows=True, override=True) is True
    assert resolve_policy_flag(policy_allows=True, override=False) is False
    assert resolve_policy_flag(policy_allows=False, override=None) is False
    assert resolve_policy_flag(policy_allows=False, override=False) is False
    assert resolve_policy_flag(policy_allows=False, override=True) is False


def test_runtime_paths_use_fail_closed_policy_resolution():
    backend = Path(__file__).resolve().parents[1]
    main_source = (backend / "app" / "main.py").read_text(encoding="utf-8")
    runtime_policy_source = (backend / "app" / "core" / "runtime_policy.py").read_text(encoding="utf-8")
    session_source = (backend / "app" / "db" / "session.py").read_text(encoding="utf-8")
    auth_source = (backend / "app" / "api" / "v1" / "auth.py").read_text(encoding="utf-8")

    # Startup owns one policy adapter; the low-level flag resolution must not be
    # duplicated back into main.py merely to satisfy this source-contract test.
    assert "validate_configured_runtime()" in main_source
    assert "validate_runtime_settings(" in runtime_policy_source
    assert "allow_demo_seed=current.allow_demo_seed" in runtime_policy_source
    assert "allow_create_all=current.allow_create_all" in runtime_policy_source

    assert "resolve_policy_flag(" in session_source
    assert "policy_allows=policy.allow_create_all" in session_source
    assert "return bool(settings.allow_create_all)" not in session_source

    assert "resolve_policy_flag(" in auth_source
    assert "policy_allows=policy.allow_demo_seed" in auth_source
    assert "return bool(settings.allow_demo_seed)" not in auth_source
