"""A-06 — environment profile guards."""
import pytest

from app.core.environment import (
    normalize_environment,
    policy_for,
    validate_runtime_settings,
)


def test_normalize_aliases():
    assert normalize_environment("dev") == "development"
    assert normalize_environment("PROD") == "production"
    assert normalize_environment("stage") == "staging"


def test_development_allows_sqlite():
    policy = validate_runtime_settings(
        environment="development",
        database_url="sqlite+aiosqlite:///./renova.db",
        public_base_url="http://127.0.0.1:8100",
        secret_key="dev-secret-change-me",
    )
    assert policy.allow_sqlite is True
    assert policy.allow_demo_seed is True
    assert policy.allow_create_all is True


def test_production_forbids_sqlite():
    with pytest.raises(ValueError, match="SQLite"):
        validate_runtime_settings(
            environment="production",
            database_url="sqlite+aiosqlite:///./renova.db",
            public_base_url="https://api.renova.app",
            secret_key="super-secret-key-32chars-min!!",
        )


def test_production_requires_https_and_secret():
    with pytest.raises(ValueError):
        validate_runtime_settings(
            environment="production",
            database_url="postgresql+asyncpg://u:p@db/renova",
            public_base_url="http://api.renova.app",
            secret_key="super-secret-key-32chars-min!!",
        )
    with pytest.raises(ValueError, match="SECRET_KEY"):
        validate_runtime_settings(
            environment="production",
            database_url="postgresql+asyncpg://u:p@db/renova",
            public_base_url="https://api.renova.app",
            secret_key="change-me",
        )


def test_staging_forbids_localhost_public_url():
    with pytest.raises(ValueError, match="localhost"):
        validate_runtime_settings(
            environment="staging",
            database_url="postgresql+asyncpg://u:p@db/renova",
            public_base_url="http://127.0.0.1:8100",
            secret_key="staging-secret-key-16+",
        )


def test_staging_ok():
    policy = validate_runtime_settings(
        environment="staging",
        database_url="postgresql+asyncpg://u:p@db/renova",
        public_base_url="https://api-staging.example.com",
        secret_key="staging-secret-key-16+",
    )
    assert policy.allow_demo_seed is False
    assert policy.allow_create_all is False


def test_unknown_environment():
    with pytest.raises(ValueError, match="Unknown"):
        policy_for("qa")
