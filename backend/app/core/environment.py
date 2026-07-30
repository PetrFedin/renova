"""Runtime environment profiles and startup guards (A-06).

Profiles: development | test | staging | production
Staging/production forbid SQLite, create_all, demo seed, and default secrets.
"""
from __future__ import annotations

from dataclasses import dataclass

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
    # P0 auth: X-User-Id without JWT is local/test only.
    allow_header_user_id: bool


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
        allow_header_user_id=True,
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
        allow_header_user_id=True,
    ),
    "staging": EnvironmentPolicy(
        name="staging",
        allow_sqlite=False,
        allow_create_all=False,
        allow_demo_seed=False,
        require_public_base_url=True,
        forbid_localhost_public_url=True,
        require_non_default_secret=True,
        require_https_public_url=True,
        allow_header_user_id=False,
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
        allow_header_user_id=False,
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


def resolve_policy_flag(*, policy_allows: bool, override: bool | None) -> bool:
    """An override may disable an allowed capability, but can never enable a forbidden one."""
    if override is None:
        return policy_allows
    return policy_allows and bool(override)


def _is_sqlite(database_url: str) -> bool:
    return database_url.strip().lower().startswith("sqlite")


def _is_localhost_url(url: str) -> bool:
    value = url.strip().lower()
    return any(
        host in value
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
    value = secret.strip().lower()
    if len(value) < 16:
        return True
    return value in DEFAULT_SECRETS


def _looks_like_email(value: str | None) -> bool:
    candidate = (value or "").strip()
    if not candidate or len(candidate) > 320 or "\r" in candidate or "\n" in candidate:
        return False
    if candidate.count("@") != 1 or " " in candidate:
        return False
    local, domain = candidate.rsplit("@", 1)
    return bool(local and domain and "." in domain)


def validate_runtime_settings(
    *,
    environment: str,
    database_url: str,
    public_base_url: str,
    secret_key: str,
    auth_allow_header_user_id: bool | None = None,
    allow_create_all: bool | None = None,
    allow_demo_seed: bool | None = None,
    ops_alert_email: str | None = None,
    smtp_host: str | None = None,
    smtp_port: int = 587,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    smtp_from: str | None = None,
) -> EnvironmentPolicy:
    """Raise ValueError before traffic if settings violate the environment policy."""
    policy = policy_for(environment)
    errors: list[str] = []

    if not policy.allow_header_user_id and auth_allow_header_user_id is True:
        errors.append(
            f"{policy.name}: AUTH_ALLOW_HEADER_USER_ID=true запрещён — только Authorization Bearer"
        )

    if not policy.allow_create_all and allow_create_all is True:
        errors.append(
            f"{policy.name}: ALLOW_CREATE_ALL=true запрещён — схема только через Alembic"
        )

    if not policy.allow_demo_seed and allow_demo_seed is True:
        errors.append(
            f"{policy.name}: ALLOW_DEMO_SEED=true запрещён — demo-данные не могут попасть в рабочую среду"
        )

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

    ops_to = (ops_alert_email or "").strip()
    host = (smtp_host or "").strip()
    user = (smtp_user or "").strip()
    password = smtp_password or ""
    sender = (smtp_from or "").strip()
    working_environment = policy.name in {"staging", "production"}

    if ops_to and not _looks_like_email(ops_to):
        errors.append(f"{policy.name}: OPS_ALERT_EMAIL имеет некорректный формат")
    if sender and not _looks_like_email(sender):
        errors.append(f"{policy.name}: SMTP_FROM имеет некорректный формат")
    if host and ("\r" in host or "\n" in host or len(host) > 255):
        errors.append(f"{policy.name}: SMTP_HOST имеет некорректный формат")
    if smtp_port < 1 or smtp_port > 65535:
        errors.append(f"{policy.name}: SMTP_PORT должен быть в диапазоне 1..65535")
    if user and not password:
        errors.append(f"{policy.name}: SMTP_USER задан без SMTP_PASSWORD")
    if working_environment and ops_to and not host:
        errors.append(
            f"{policy.name}: OPS_ALERT_EMAIL задан, но SMTP_HOST отсутствует — alert не может быть log-only"
        )
    if working_environment and host and not (sender or user):
        errors.append(
            f"{policy.name}: SMTP_FROM или SMTP_USER обязателен для рабочей SMTP-доставки"
        )

    if errors:
        raise ValueError("Environment guard failed:\n- " + "\n- ".join(errors))

    return policy


def collect_warnings(
    *,
    environment: str,
    database_url: str,
    secret_key: str,
    kontur_mode: str | None = None,
    kontur_api_key: str | None = None,
    yookassa_shop_id: str | None = None,
    yookassa_secret: str | None = None,
    esign_webhook_secret: str | None = None,
    yookassa_webhook_secret: str | None = None,
    ops_alert_email: str | None = None,
    smtp_host: str | None = None,
) -> list[str]:
    """Soft warnings for development/staging (do not fail startup)."""
    name = normalize_environment(environment)
    warnings: list[str] = []
    if name == "development":
        if _is_default_secret(secret_key):
            warnings.append("development: SECRET_KEY is default — OK for local only")
        if _is_sqlite(database_url):
            warnings.append("development: using SQLite — switch to Postgres before staging")
        if (ops_alert_email or "").strip() and not (smtp_host or "").strip():
            warnings.append(
                "development: OPS_ALERT_EMAIL configured without SMTP_HOST — email is preview only"
            )
    mode = (kontur_mode or "off").strip().lower()
    if name == "staging" and mode in ("sandbox", "live") and not (kontur_api_key or "").strip():
        warnings.append(
            f"staging: KONTUR_MODE={mode} but KONTUR_API_KEY is missing — e-sign will stay unconfigured"
        )
    if name in ("staging", "production") and mode in ("sandbox", "live") and not (esign_webhook_secret or "").strip():
        warnings.append(
            f"{name}: KONTUR_MODE={mode} but ESIGN_WEBHOOK_SECRET missing — webhooks will 503"
        )
    if name in ("staging", "production"):
        if not ((yookassa_shop_id or "").strip() and (yookassa_secret or "").strip()):
            warnings.append(
                f"{name}: YOOKASSA_SHOP_ID/YOOKASSA_SECRET missing — card checkout returns 503 (demo disabled)"
            )
        if (yookassa_shop_id or "").strip() and not (yookassa_webhook_secret or "").strip():
            warnings.append(
                f"{name}: YOOKASSA_WEBHOOK_SECRET empty — webhook endpoint will 503"
            )
    return warnings
