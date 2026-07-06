"""Конfigурация backend Renova."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    app_name: str = "Renova API"
    # SQLite для локальной разработки; PostgreSQL в production
    database_url: str = "sqlite+aiosqlite:///./renova.db"
    secret_key: str = "dev-secret-change-me"
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
    public_base_url: str = "http://127.0.0.1:8100"


    cloudfront_domain: str | None = None
    cloudfront_key_id: str | None = None
    s3_public_url: str | None = None  # CDN URL prefix

    sentry_dsn: str | None = None

    log_json: bool = False

    rate_limit_rpm: int = 120

    twilio_sid: str | None = None

    twilio_token: str | None = None

    twilio_from: str | None = None

settings = Settings()


# S3/MinIO (опционально; без них — локальная папка uploads/)
