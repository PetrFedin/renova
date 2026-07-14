"""E-sign providers (Wave 3b). Канон: in_app + stubs внешних провайдеров."""
from app.services.esign.registry import get_provider, list_providers

__all__ = ["get_provider", "list_providers"]
