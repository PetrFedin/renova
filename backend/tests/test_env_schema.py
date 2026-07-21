"""Env schema / capability guards — names only in errors, no secret leakage."""
import pytest

from app.core.environment import (
    classify_env_vars,
    validate_capability_settings,
    validate_runtime_settings,
)


def test_classify_categories_present():
    cats = classify_env_vars()
    assert "required_always" in cats
    assert "required_in_production" in cats
    assert "optional" in cats
    assert "provider_specific" in cats
    assert "never_in_expo_public" in cats
    assert "SECRET_KEY" in cats["never_in_expo_public"]


def test_production_requires_sentry_or_exception():
    with pytest.raises(ValueError, match="SENTRY_DSN") as ei:
        validate_capability_settings(
            environment="production",
            public_base_url="https://api.example.com",
            sentry_dsn=None,
            sentry_approved_without_dsn=False,
        )
    msg = str(ei.value)
    assert "super-secret" not in msg
    assert "password" not in msg.lower() or "SENTRY" in msg


def test_production_sentry_approved_exception():
    validate_capability_settings(
        environment="production",
        public_base_url="https://api.example.com",
        sentry_dsn=None,
        sentry_approved_without_dsn=True,
    )


def test_s3_provider_specific():
    with pytest.raises(ValueError, match="S3_ACCESS_KEY"):
        validate_capability_settings(
            environment="development",
            s3_endpoint="http://127.0.0.1:9000",
            s3_access_key=None,
            s3_secret_key="should-not-appear-in-error",
            s3_bucket="renova",
        )


def test_s3_error_omits_secret_value():
    with pytest.raises(ValueError) as ei:
        validate_capability_settings(
            environment="development",
            s3_endpoint="http://127.0.0.1:9000",
            s3_access_key="AKIA_TEST",
            s3_secret_key=None,
            s3_bucket="renova",
        )
    assert "should-not" not in str(ei.value)
    assert "S3_SECRET_KEY" in str(ei.value)


def test_yookassa_mutually_required():
    with pytest.raises(ValueError, match="YOOKASSA"):
        validate_capability_settings(
            environment="development",
            yookassa_shop_id="shop",
            yookassa_secret=None,
        )


def test_moy_nalog_provider_specific():
    with pytest.raises(ValueError, match="MOY_NALOG_CLIENT_ID"):
        validate_capability_settings(
            environment="staging",
            public_base_url="https://api.example.com",
            moy_nalog_enabled=True,
            moy_nalog_client_id=None,
            moy_nalog_client_secret="leak-me-not",
            moy_nalog_redirect_uri="https://app/cb",
            moy_nalog_token_url="https://token",
        )
    # secret value must not appear
    # (raised above — re-check via match only on names)


def test_moy_nalog_error_has_no_secret_value():
    with pytest.raises(ValueError) as ei:
        validate_capability_settings(
            environment="staging",
            public_base_url="https://api.example.com",
            moy_nalog_enabled=True,
            moy_nalog_client_id=None,
            moy_nalog_client_secret="leak-me-not-xyz",
            moy_nalog_redirect_uri="https://app/cb",
            moy_nalog_token_url="https://token",
        )
    assert "leak-me-not-xyz" not in str(ei.value)


def test_cors_star_forbidden_in_production():
    with pytest.raises(ValueError, match="CORS_ALLOWED_ORIGINS"):
        validate_capability_settings(
            environment="production",
            public_base_url="https://api.example.com",
            sentry_approved_without_dsn=True,
            cors_allowed_origins="*",
        )


def test_development_allows_missing_optional_providers():
    validate_capability_settings(environment="development")
    validate_runtime_settings(
        environment="development",
        database_url="sqlite+aiosqlite:///./renova.db",
        public_base_url="http://127.0.0.1:8100",
        secret_key="dev-secret-change-me",
    )
