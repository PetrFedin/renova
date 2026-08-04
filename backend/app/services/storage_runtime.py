"""Storage configuration and live-runtime gates for deployment preflight."""
from __future__ import annotations

from app.services.storage_service import (
    StorageConfigurationError,
    _s3_config_state,
    ensure_bucket,
)


def validate_storage_configuration() -> str:
    """Validate local/S3 mode selection without making network calls."""
    state = _s3_config_state()
    if state == "partial":
        raise StorageConfigurationError("partial_s3_configuration")
    return "s3" if state == "configured" else "local"


def validate_storage_runtime() -> None:
    """Perform the same live storage availability gate as API startup."""
    validate_storage_configuration()
    ensure_bucket()
