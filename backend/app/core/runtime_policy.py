"""Single source of truth for configured runtime policy evaluation."""
from __future__ import annotations

from collections.abc import Sequence

from app.core.config import Settings, settings
from app.core.environment import EnvironmentPolicy, collect_warnings, validate_runtime_settings


def validate_configured_runtime(
    configured: Settings = settings,
) -> EnvironmentPolicy:
    """Apply the exact startup policy to a Settings instance."""
    return validate_runtime_settings(
        environment=configured.environment,
        database_url=configured.database_url,
        public_base_url=configured.public_base_url,
        secret_key=configured.secret_key,
        auth_allow_header_user_id=configured.auth_allow_header_user_id,
        allow_create_all=configured.allow_create_all,
        allow_demo_seed=configured.allow_demo_seed,
        ops_alert_email=configured.ops_alert_email,
        smtp_host=configured.smtp_host,
        smtp_port=configured.smtp_port,
        smtp_user=configured.smtp_user,
        smtp_password=configured.smtp_password,
        smtp_from=configured.smtp_from,
        redis_url=configured.redis_url,
        twilio_sid=configured.twilio_sid,
        twilio_token=configured.twilio_token,
        twilio_from=configured.twilio_from,
    )


def configured_runtime_warnings(
    configured: Settings = settings,
) -> Sequence[str]:
    """Return startup warnings using the same Settings instance as validation."""
    return collect_warnings(
        environment=configured.environment,
        database_url=configured.database_url,
        secret_key=configured.secret_key,
        kontur_mode=configured.kontur_mode,
        kontur_api_key=configured.kontur_api_key,
        yookassa_shop_id=configured.yookassa_shop_id,
        yookassa_secret=configured.yookassa_secret,
        esign_webhook_secret=configured.esign_webhook_secret,
        yookassa_webhook_secret=configured.yookassa_webhook_secret,
        ops_alert_email=configured.ops_alert_email,
        smtp_host=configured.smtp_host,
        redis_url=configured.redis_url,
        twilio_sid=configured.twilio_sid,
        twilio_token=configured.twilio_token,
        twilio_from=configured.twilio_from,
    )
