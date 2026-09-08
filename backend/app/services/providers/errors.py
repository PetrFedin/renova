"""Единая иерархия ошибок внешних провайдеров.

Повторяет семантику, уже принятую в sms_service / fns.status_npd:
- Configuration  — провайдер не может быть вызван (нет ключей, режим off);
- Retryable      — временный отказ, безопасно повторить с тем же idempotency key;
- Ambiguous      — запрос ушёл, ответ не получен: состояние у провайдера неизвестно,
                   повторять НЕЛЬЗЯ без reconciliation (см. AGENTS.md §5);
- Rejected       — провайдер отказал окончательно (невалидные данные, лимит, дубликат);
- Protocol       — ответ провайдера не соответствует контракту адаптера.

Доменный код ловит только эти классы. Специфичные исключения провайдера
(httpx, boto3, twilio) адаптер обязан перевести в один из них.
"""
from __future__ import annotations


class ProviderError(RuntimeError):
    """База. `provider` — имя реализации, `code` — стабильный машинный код."""

    def __init__(self, message: str, *, provider: str, code: str = "provider_error", retry_after_sec: float | None = None):
        super().__init__(message)
        self.provider = provider
        self.code = code
        self.retry_after_sec = retry_after_sec


class ProviderConfigurationError(ProviderError):
    def __init__(self, message: str, *, provider: str, code: str = "provider_not_configured"):
        super().__init__(message, provider=provider, code=code)


class ProviderRetryable(ProviderError):
    def __init__(self, message: str, *, provider: str, code: str = "provider_retryable", retry_after_sec: float | None = None):
        super().__init__(message, provider=provider, code=code, retry_after_sec=retry_after_sec)


class ProviderAmbiguous(ProviderError):
    """Запрос мог быть исполнен. Запрещено автоматически повторять."""

    def __init__(self, message: str, *, provider: str, code: str = "provider_ambiguous"):
        super().__init__(message, provider=provider, code=code)


class ProviderRejected(ProviderError):
    def __init__(self, message: str, *, provider: str, code: str = "provider_rejected"):
        super().__init__(message, provider=provider, code=code)


class ProviderProtocolError(ProviderError):
    def __init__(self, message: str, *, provider: str, code: str = "provider_protocol_error"):
        super().__init__(message, provider=provider, code=code)


class SimulatedProviderForbidden(ProviderConfigurationError):
    """Симулятор запрошен в окружении, где он запрещён (staging/production)."""

    def __init__(self, provider: str, environment: str):
        super().__init__(
            f"simulated provider '{provider}' is forbidden in environment '{environment}'",
            provider=provider,
            code="simulated_provider_forbidden",
        )
