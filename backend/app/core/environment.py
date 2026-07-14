"""Runtime environment profiles and startup guards (A-06).

Profiles: development | test | staging | production
Staging/production forbid SQLite, create_all, demo seed, and default secrets.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

ALLOWED_ENVIRONMENTS = frozenset({"development", "test", "staging", "production"})


@dataclass(frozen=True)
class EnvironmentPolicy:
    name: str
    allow_sqlite: bool
    allow_create_all: bool
    allow_demo_seed: bool
    require_public_base_url: bool
    forbid_localhost_public_url: bool
    require_non_default_secret: bool
    require_https_public_url: bool


POLICIES: dict[str, EnvironmentPolicy] = {
    "development": EnvironmentPolicy(
        name="development",
        allow_sqlite=True,
        allow_create_all=True,
        allow_demo_seed=True,
        require_public_base_url=False,
        forbid_localhost_public_url=False,
        require_non_default_secret=False,
        require_https_public_url=False,
    ),
    "test": EnvironmentPolicy(
        name="test",
        allow_sqlite=True,
        allow_create_all=True,
        allow_demo_seed=True,
        require_public_base_url=False,
        forbid_localhost_public_url=False,
        require_non_default_secret=False,
        require_https_public_url=False,
    ),
    "staging": EnvironmentPolicy(
        name="staging",
        allow_sqlite=False,
        allow_create_all=False,
        allow_demo_seed=False,
        require_public_base_url=True,
        forbid_localhost_public_url=True,
        require_non_default_secret=True,
        require_https_public_url=False,
    ),
    "production": EnvironmentPolicy(
        name="production",
        allow_sqlite=False,
        allow_create_all=False,
        allow_demo_seed=False,
        require_public_base_url=True,
        forbid_localhost_public_url=True,
        require_non_default_secret=True,
        require_https_public_url=True,
    ),
}

DEFAULT_SECRETS: frozenset[str] = frozenset({
    "dev-secret-change-me",
    "change-me",
    "changeme",
    "secret",
    "password",
})


def normalize_environment(value: str | None) -> str:
    name = (value or "development").strip().lower()
    if name in {"dev", "local"}:
        return "development"
    if name in {"prod", "prd"}:
        return "production"
    if name in {"stage", "stg"}:
        return "staging"
    return name


def policy_for(environment: str) -> EnvironmentPolicy:
    name = normalize_environment(environment)
    if name not in POLICIES:
        raise ValueError(
            f"Unknown ENVIRONMENT={environment!r}. "
            f"Allowed: {', '.join(sorted(ALLOWED_ENVIRONMENTS))}"
        )
    return POLICIES[name]


def _is_sqlite(database_url: str) -> bool:
    return database_url.strip().lower().startswith("sqlite")


def _is_localhost_url(url: str) -> bool:
    u = url.strip().lower()
    return any(
        host in u
        for host in (
            "://127.0.0.1",
            "://localhost",
            "://0.0.0.0",
            "://[::1]",
        )
    )


def _is_https(url: str) -> bool:
    return url.strip().lower().startswith("https://")


def _is_default_secret(secret: str) -> bool:
    s = secret.strip().lower()
    if len(s) < 16:
        return True
    # Exact weak values only — не банить ключи, где случайно есть слово "secret"
    return s in DEFAULT_SECRETS


def validate_runtime_settings(
    *,
    environment: str,
    database_url: str,
    public_base_url: str,
    secret_key: str,
) -> EnvironmentPolicy:
    """Raise ValueError if settings violate profile policy."""
    policy = policy_for(environment)

    errors: list[str] = []

    if not policy.allow_sqlite and _is_sqlite(database_url):
        errors.append(
            f"{policy.name}: SQLite запрещён. Установите DATABASE_URL=postgresql+asyncpg://…"
        )

    if policy.require_public_base_url and not (public_base_url or "").strip():
        errors.append(f"{policy.name}: PUBLIC_BASE_URL обязателен")

    if policy.forbid_localhost_public_url and _is_localhost_url(public_base_url or ""):
        errors.append(
            f"{policy.name}: PUBLIC_BASE_URL не может быть localhost/127.0.0.1"
        )

    if policy.require_https_public_url and not _is_https(public_base_url or ""):
        errors.append(f"{policy.name}: PUBLIC_BASE_URL должен начинаться с https://")

    if policy.require_non_default_secret and _is_default_secret(secret_key or ""):
        errors.append(
            f"{policy.name}: SECRET_KEY должен быть уникальным (≥16 символов, не default)"
        )

    if errors:
        raise ValueError("Environment guard failed:\n- " + "\n- ".join(errors))

    return policy


def collect_warnings(
    *,
    environment: str,
    database_url: str,
    secret_key: str,
) -> list[str]:
    """Soft warnings for development (do not fail startup)."""
    name = normalize_environment(environment)
    warnings: list[str] = []
    if name == "development":
        if _is_default_secret(secret_key):
            warnings.append("development: SECRET_KEY is default — OK for local only")
        if _is_sqlite(database_url):
            warnings.append("development: using SQLite — switch to Postgres before staging")
    return warnings
