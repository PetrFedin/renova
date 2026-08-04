"""Single source of truth for configured runtime policy evaluation."""
from __future__ import annotations

from collections.abc import Sequence

from app.core.config import Settings, settings
from app.core.environment import EnvironmentPolicy, collect_warnings, validate_runtime_settings


def validate_configured_runtime(
    configured: Settings | None = None,
) -> EnvironmentPolicy:
    """Apply the exact startup policy to a Settings instance."""
    current = configured or settings
    return validate_runtime_settings(
        environment=current.environment,
        database_url=current.database_url,
        public_base_url=current.public_base_url,
        secret_key=current.secret_key,
        auth_allow_header_user_id=current.auth_allow_header_user_id,
        allow_create_all=current.allow_create_all,
        allow_demo_seed=current.allow_demo_seed,
        ops_alert_email=current.ops_alert_email,
        smtp_host=current.smtp_host,
        smtp_port=current.smtp_port,
        smtp_user=current.smtp_user,
        smtp_password=current.smtp_password,
        smtp_from=current.smtp_from,
        redis_url=current.redis_url,
        twilio_sid=current.twilio_sid,
        twilio_token=current.twilio_token,
        twilio_from=current.twilio_from,
    )


def configured_runtime_warnings(
    configured: Settings | None = None,
) -> Sequence[str]:
    """Return startup warnings using the same Settings instance as validation."""
    current = configured or settings
    return collect_warnings(
        environment=current.environment,
        database_url=current.database_url,
        secret_key=current.secret_key,
        kontur_mode=current.kontur_mode,
        kontur_api_key=current.kontur_api_key,
        yookassa_shop_id=current.yookassa_shop_id,
        yookassa_secret=current.yookassa_secret,
        esign_webhook_secret=current.esign_webhook_secret,
        yookassa_webhook_secret=current.yookassa_webhook_secret,
        ops_alert_email=current.ops_alert_email,
        smtp_host=current.smtp_host,
        redis_url=current.redis_url,
        twilio_sid=current.twilio_sid,
        twilio_token=current.twilio_token,
        twilio_from=current.twilio_from,
    )
