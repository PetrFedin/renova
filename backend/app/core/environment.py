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
    # P0 auth: X-User-Id без JWT только local/test
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
        require_https_public_url=True,  # P1: staging = реальный пилот / TestFlight
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
    auth_allow_header_user_id: bool | None = None,
    moy_nalog_dev_bypass_enabled: bool | None = None,
) -> EnvironmentPolicy:
    """Raise ValueError if settings violate profile policy."""
    policy = policy_for(environment)

    errors: list[str] = []

    # P0 auth: нельзя форсировать X-User-Id в staging/production
    if not policy.allow_header_user_id and auth_allow_header_user_id is True:
        errors.append(
            f"{policy.name}: AUTH_ALLOW_HEADER_USER_ID=true запрещён — только Authorization Bearer"
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

    # Dev bypass «Мой налог» нельзя оставлять включённым в staging/production
    if not policy.allow_demo_seed and moy_nalog_dev_bypass_enabled is True:
        errors.append(
            f"{policy.name}: MY_NALOG_DEV_BYPASS_ENABLED=true запрещён — только development/test"
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
) -> list[str]:
    """Soft warnings for development/staging (do not fail startup)."""
    name = normalize_environment(environment)
    warnings: list[str] = []
    if name == "development":
        if _is_default_secret(secret_key):
            warnings.append("development: SECRET_KEY is default — OK for local only")
        if _is_sqlite(database_url):
            warnings.append("development: using SQLite — switch to Postgres before staging")
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


# --- Capability-aware production validation (release-ops hardening) ---
# Errors MUST name variables only — never interpolate secret values.


def _truthy(value: str | bool | None) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _blank(value: str | None) -> bool:
    return not (value or "").strip()


def _missing(name: str) -> str:
    """Standard missing-var message (name only)."""
    return f"missing required variable: {name}"


def validate_capability_settings(
    *,
    environment: str,
    # Sentry
    sentry_dsn: str | None = None,
    sentry_approved_without_dsn: bool | str | None = None,
    # Storage
    s3_endpoint: str | None = None,
    s3_access_key: str | None = None,
    s3_secret_key: str | None = None,
    s3_bucket: str | None = None,
    # Payments
    yookassa_shop_id: str | None = None,
    yookassa_secret: str | None = None,
    yookassa_webhook_secret: str | None = None,
    # OAuth Moy nalog
    moy_nalog_enabled: bool | str | None = None,
    moy_nalog_client_id: str | None = None,
    moy_nalog_client_secret: str | None = None,
    moy_nalog_redirect_uri: str | None = None,
    moy_nalog_token_url: str | None = None,
    # E-sign
    kontur_mode: str | None = None,
    kontur_api_key: str | None = None,
    esign_webhook_secret: str | None = None,
    # Twilio
    twilio_sid: str | None = None,
    twilio_token: str | None = None,
    twilio_from: str | None = None,
    # CORS / portal
    cors_allowed_origins: str | None = None,
    public_base_url: str | None = None,
) -> None:
    """Fail-fast for provider-specific and production-required capabilities.

    Categories:
    - required always: ENVIRONMENT (validated via policy_for)
    - required in production/staging: PUBLIC_BASE_URL, SECRET_KEY, DATABASE_URL (via validate_runtime_settings)
    - optional: REDIS_URL, SMTP_*, OLLAMA_*, CLOUDFRONT_*
    - mutually exclusive: none hard-coded (CloudFront vs raw S3 public URL co-exist as soft ops choice)
    - provider-specific: YooKassa / S3 / Moy nalog / Kontur / Twilio when enabled or partially configured
    """
    name = normalize_environment(environment)
    errors: list[str] = []
    release_like = name in ("staging", "production")

    # Sentry: production requires DSN unless explicit approved exception
    if name == "production":
        if _blank(sentry_dsn) and not _truthy(sentry_approved_without_dsn):
            errors.append(
                _missing("SENTRY_DSN")
                + " (or set SENTRY_APPROVED_WITHOUT_DSN=true as explicit approved exception)"
            )

    # S3: if endpoint set, credentials required
    if not _blank(s3_endpoint):
        if _blank(s3_access_key):
            errors.append(_missing("S3_ACCESS_KEY"))
        if _blank(s3_secret_key):
            errors.append(_missing("S3_SECRET_KEY"))
        if _blank(s3_bucket):
            errors.append(_missing("S3_BUCKET"))

    # YooKassa: partial config is invalid; full pair required if either set
    shop = not _blank(yookassa_shop_id)
    ysec = not _blank(yookassa_secret)
    if shop ^ ysec:
        errors.append(
            "provider-specific: YOOKASSA_SHOP_ID and YOOKASSA_SECRET are mutually required "
            "(set both or neither)"
        )
    if shop and release_like and _blank(yookassa_webhook_secret):
        errors.append(_missing("YOOKASSA_WEBHOOK_SECRET"))

    # Moy nalog OAuth when enabled
    if _truthy(moy_nalog_enabled):
        for var, val in (
            ("MOY_NALOG_CLIENT_ID", moy_nalog_client_id),
            ("MOY_NALOG_CLIENT_SECRET", moy_nalog_client_secret),
            ("MOY_NALOG_REDIRECT_URI", moy_nalog_redirect_uri),
            ("MOY_NALOG_TOKEN_URL", moy_nalog_token_url),
        ):
            if _blank(val):
                errors.append(_missing(var))

    # Kontur when mode on
    mode = (kontur_mode or "off").strip().lower()
    if mode in ("sandbox", "live"):
        if _blank(kontur_api_key):
            errors.append(_missing("KONTUR_API_KEY"))
        if release_like and _blank(esign_webhook_secret):
            errors.append(_missing("ESIGN_WEBHOOK_SECRET"))

    # Twilio partial
    if not _blank(twilio_sid):
        if _blank(twilio_token):
            errors.append(_missing("TWILIO_TOKEN"))
        if _blank(twilio_from):
            errors.append(_missing("TWILIO_FROM"))

    # Staging/prod: CORS should not be empty "*" implicitly — require explicit origins or rely on PUBLIC_BASE_URL
    if release_like:
        raw = (cors_allowed_origins or "").strip()
        if raw == "*":
            errors.append(
                "CORS_ALLOWED_ORIGINS cannot be * in staging/production "
                "(list explicit origins or leave empty to use PUBLIC_BASE_URL)"
            )
        if _blank(public_base_url):
            errors.append(_missing("PUBLIC_BASE_URL"))

    if errors:
        raise ValueError("Environment capability guard failed:\n- " + "\n- ".join(errors))


def classify_env_vars() -> dict[str, list[str]]:
    """Documentation helper for operators / tests (names only)."""
    return {
        "required_always": ["ENVIRONMENT"],
        "required_in_production": [
            "DATABASE_URL",
            "PUBLIC_BASE_URL",
            "SECRET_KEY",
            "SENTRY_DSN",  # or SENTRY_APPROVED_WITHOUT_DSN
        ],
        "optional": [
            "REDIS_URL",
            "SMTP_HOST",
            "SMTP_USER",
            "SMTP_PASSWORD",
            "CLOUDFRONT_DOMAIN",
            "CLOUDFRONT_KEY_ID",
            "OLLAMA_BASE_URL",
            "OPS_ALERT_EMAIL",
        ],
        "mutually_exclusive_pairs": [
            # documented: shop_id XOR secret is invalid (both-or-neither)
            "YOOKASSA_SHOP_ID+YOOKASSA_SECRET",
        ],
        "provider_specific": [
            "S3_ENDPOINT→S3_ACCESS_KEY,S3_SECRET_KEY,S3_BUCKET",
            "MOY_NALOG_ENABLED→MOY_NALOG_CLIENT_ID,MOY_NALOG_CLIENT_SECRET,MOY_NALOG_REDIRECT_URI,MOY_NALOG_TOKEN_URL",
            "KONTUR_MODE=sandbox|live→KONTUR_API_KEY[,ESIGN_WEBHOOK_SECRET]",
            "TWILIO_SID→TWILIO_TOKEN,TWILIO_FROM",
            "YOOKASSA_SHOP_ID→YOOKASSA_SECRET[,YOOKASSA_WEBHOOK_SECRET in staging/prod]",
        ],
        "mobile_public_only": [
            "EXPO_PUBLIC_API_URL",
            "EXPO_PUBLIC_APP_ENV",
            "EXPO_PUBLIC_DEMO",
            "EXPO_PUBLIC_SENTRY_DSN",
        ],
        "never_in_expo_public": [
            "SECRET_KEY",
            "DATABASE_URL",
            "YOOKASSA_SECRET",
            "S3_SECRET_KEY",
            "MOY_NALOG_CLIENT_SECRET",
            "TWILIO_TOKEN",
            "KONTUR_API_KEY",
        ],
    }
