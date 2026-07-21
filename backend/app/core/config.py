"""Конфигурация backend Renova."""
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.environment import normalize_environment


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    app_name: str = "Renova API"
    # SQLite только development/test; staging/production — PostgreSQL (см. environment.py)
    database_url: str = "sqlite+aiosqlite:///./renova.db"
    # Optional: REDIS_URL for multi-instance WS pub/sub (empty = in-process only)
    redis_url: str | None = None
    secret_key: str = "dev-secret-change-me"
    # JWT (HS256). Staging/production: только Bearer, без X-User-Id.
    access_token_expire_minutes: int = 60 * 24 * 14  # local default; staging/prod capped to 20m in security.py
    refresh_token_expire_days: int = 30
    # None = по policy профиля; True/False = явный override
    auth_allow_header_user_id: bool | None = None
    fns_npd_status_url: str = (
        "https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status"
    )
    moy_nalog_enabled: bool = False
    s3_endpoint: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket: str = "renova"
    uploads_dir: str = "./uploads"
    contractor_free_project_limit: int = 1
    yookassa_shop_id: str | None = None
    yookassa_secret: str | None = None
    yookassa_webhook_secret: str | None = None
    fns_receipt_api_url: str = "https://proverkacheka.nalog.ru:9999/v1/inns/*/kkts/*/fss/*"
    # Optional Basic auth for proverkacheka (phone/INN + password from «Мой налог» / FNS)
    fns_receipt_login: str | None = None
    fns_receipt_password: str | None = None
    public_base_url: str = "http://127.0.0.1:8100"

    cloudfront_domain: str | None = None
    cloudfront_key_id: str | None = None
    s3_public_url: str | None = None

    sentry_dsn: str | None = None

    log_json: bool = False

    rate_limit_rpm: int = 120

    twilio_sid: str | None = None
    twilio_token: str | None = None
    twilio_from: str | None = None

    # Явные флаги (по умолчанию следуют policy profile)
    allow_create_all: bool | None = None
    allow_demo_seed: bool | None = None
    # sync = classify in upload request; async = enqueue + worker tick/loop
    document_ocr_mode: str = "sync"
    document_ocr_worker_interval_sec: float = 5.0
    # Periodic reminders: materials, overdue stages, waste pickup (dev default 15 min)
    automation_reminders_enabled: bool = True
    automation_reminders_interval_sec: float = 900.0
    # Ops: email при 3+ consecutive failures automation worker (stub → SMTP)
    ops_alert_email: str | None = None
    # Optional Ollama for weekly digest narrative (empty = rule-based only)
    ollama_base_url: str | None = None  # e.g. http://127.0.0.1:11434
    ollama_model: str = "qwen3"
    ollama_digest_enabled: bool = False
    # SMTP (optional). Без host — log-only stub.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_use_tls: bool = True
    # E-sign external (Wave 3f). Без ключей → 501 как раньше.
    kontur_api_key: str | None = None
    kontur_api_url: str = "https://api.kontur.ru/sign/v1"  # placeholder
    kontur_mode: str = "off"  # off | sandbox | live
    goskey_client_id: str | None = None
    goskey_mode: str = "off"  # off | sandbox | live
    esign_webhook_secret: str | None = None

    @property
    def normalized_environment(self) -> str:
        return normalize_environment(self.environment)

    @property
    def allow_header_user_id(self) -> bool:
        """Legacy X-User-Id: only when policy/override allows (dev/test)."""
        if self.auth_allow_header_user_id is not None:
            return bool(self.auth_allow_header_user_id)
        from app.core.environment import policy_for

        return policy_for(self.normalized_environment).allow_header_user_id


settings = Settings()
