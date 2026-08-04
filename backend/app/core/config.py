"""Конфигурация backend Renova."""
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.environment import normalize_environment


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    app_name: str = "Renova API"
    database_url: str = "sqlite+aiosqlite:///./renova.db"
    redis_url: str | None = None
    allow_account_purge: bool = False
    account_purge_ops_secret: str | None = None
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 24 * 14
    refresh_token_expire_days: int = 30
    auth_allow_header_user_id: bool | None = None
    # Comma-separated immutable user ids permitted to use /admin in working envs.
    # Empty configuration is intentionally fail-closed on staging/production.
    admin_user_ids: str = ""
    fns_npd_status_url: str = "https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status"
    moy_nalog_enabled: bool = False
    moy_nalog_client_id: str | None = None
    moy_nalog_client_secret: str | None = None
    moy_nalog_redirect_uri: str | None = None
    moy_nalog_authorize_url: str = "https://lknpd.nalog.ru/api/v1/auth/login"
    moy_nalog_token_url: str | None = None
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
    fns_receipt_login: str | None = None
    fns_receipt_password: str | None = None
    public_base_url: str = "http://127.0.0.1:8100"

    cloudfront_domain: str | None = None
    cloudfront_key_id: str | None = None
    s3_public_url: str | None = None

    sentry_dsn: str | None = None
    cors_allowed_origins: str = ""
    log_json: bool = False
    rate_limit_rpm: int = 120

    twilio_sid: str | None = None
    twilio_token: str | None = None
    twilio_from: str | None = None

    allow_create_all: bool | None = None
    allow_demo_seed: bool | None = None
    # off | metadata. Real OCR engine modes are not exposed until content reading exists.
    document_ocr_mode: str = "metadata"
    document_ocr_worker_interval_sec: float = 5.0
    automation_reminders_enabled: bool = True
    automation_reminders_interval_sec: float = 900.0
    ops_alert_email: str | None = None
    ollama_base_url: str | None = None
    ollama_model: str = "qwen3"
    ollama_digest_enabled: bool = False
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_use_tls: bool = True
    kontur_api_key: str | None = None
    kontur_api_url: str = "https://api.kontur.ru/sign/v1"
    kontur_mode: str = "off"
    goskey_client_id: str | None = None
    goskey_mode: str = "off"
    esign_webhook_secret: str | None = None

    @property
    def normalized_environment(self) -> str:
        return normalize_environment(self.environment)

    @property
    def allow_header_user_id(self) -> bool:
        if self.auth_allow_header_user_id is not None:
            return bool(self.auth_allow_header_user_id)
        from app.core.environment import policy_for

        return policy_for(self.normalized_environment).allow_header_user_id

    @property
    def admin_user_id_set(self) -> frozenset[str]:
        return frozenset(
            value.strip()
            for value in (self.admin_user_ids or "").split(",")
            if value.strip()
        )


settings = Settings()
