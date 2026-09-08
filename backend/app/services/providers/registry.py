"""Реестр провайдеров: единственная точка, где доменный код получает реализацию порта.

Разрешение режима:
    settings.<provider>_mode  →  off | simulated | real
    (задача A7: alias для существующих kontur_mode / goskey_mode / document_ocr_mode)

Fail-closed правила (повторяют app.core.environment / runtime_policy):
- `simulated` запрещён, если policy.name ∈ {staging, production};
- `real` без обязательных credentials — ProviderConfigurationError на старте
  (validate_providers_runtime вызывается из lifespan рядом с validate_esign_runtime);
- `off` — реализация `_OffProvider`, которая бросает ProviderConfigurationError
  при любом вызове, но отдаёт health(available=False) для /ready.

Реестр намеренно не кэширует экземпляры между тестами: `reset()` вызывается
из conftest, чтобы тесты могли подменять режим через monkeypatch settings.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from app.core.config import settings
from app.core.environment import policy_for
from app.services.providers import base
from app.services.providers.errors import ProviderConfigurationError, SimulatedProviderForbidden

logger = logging.getLogger(__name__)

_SIMULATED_FORBIDDEN_ENVIRONMENTS = {"staging", "production"}

_PORTS = ("payment", "fiscal_receipt", "npd_status", "sms", "push")

_cache: dict[str, Any] = {}


def reset() -> None:
    _cache.clear()


def _mode_for(port: str) -> base.ProviderMode:
    raw = getattr(settings, f"{port}_provider_mode", None) or "off"
    try:
        return base.ProviderMode(str(raw).strip().lower())
    except ValueError as exc:
        raise ProviderConfigurationError(
            f"invalid {port}_provider_mode={raw!r}; expected off|simulated|real",
            provider=port,
            code="invalid_provider_mode",
        ) from exc


def _guard_environment(port: str, mode: base.ProviderMode) -> None:
    policy = policy_for(settings.environment)
    if mode is base.ProviderMode.SIMULATED and policy.name in _SIMULATED_FORBIDDEN_ENVIRONMENTS:
        raise SimulatedProviderForbidden(port, policy.name)


class _OffProvider:
    """Заглушка для mode=off. Любой вызов — ошибка конфигурации, health — недоступен."""

    mode = base.ProviderMode.OFF

    def __init__(self, port: str):
        self.name = f"{port}:off"
        self._port = port

    def health(self) -> base.ProviderHealth:
        return base.ProviderHealth(name=self.name, mode=self.mode, available=False, detail="mode=off")

    def __getattr__(self, item: str) -> Callable[..., Any]:
        async def _raise(*_: Any, **__: Any) -> Any:
            raise ProviderConfigurationError(
                f"{self._port} provider is off", provider=self.name, code=f"{self._port}_provider_off"
            )

        if item.startswith("_"):
            raise AttributeError(item)
        return _raise


def _build(port: str) -> Any:
    mode = _mode_for(port)
    _guard_environment(port, mode)
    if mode is base.ProviderMode.OFF:
        return _OffProvider(port)

    # Ленивая загрузка, чтобы неиспользуемые адаптеры (boto3/httpx-специфика)
    # не импортировались на старте и не требовали своих зависимостей.
    if mode is base.ProviderMode.SIMULATED:
        if port == "payment":
            from app.services.providers.simulated.payment import SimulatedPaymentProvider

            return SimulatedPaymentProvider()
        if port == "fiscal_receipt":
            from app.services.providers.simulated.fiscal import SimulatedFiscalReceiptProvider  # A5

            return SimulatedFiscalReceiptProvider()
        if port == "npd_status":
            from app.services.providers.simulated.npd import SimulatedNpdStatusProvider  # A5

            return SimulatedNpdStatusProvider()
        if port == "sms":
            from app.services.providers.simulated.messaging import SimulatedSmsProvider  # A6

            return SimulatedSmsProvider()
        if port == "push":
            from app.services.providers.simulated.messaging import SimulatedPushProvider  # A6

            return SimulatedPushProvider()

    if mode is base.ProviderMode.REAL:
        if port == "payment":
            from app.services.providers.adapters.yookassa import YooKassaPaymentProvider  # A4

            return YooKassaPaymentProvider.from_settings(settings)
        if port == "fiscal_receipt":
            from app.services.providers.adapters.fns_receipt import FnsReceiptProvider  # A5

            return FnsReceiptProvider.from_settings(settings)
        if port == "npd_status":
            from app.services.providers.adapters.fns_npd import FnsNpdStatusProvider  # A5

            return FnsNpdStatusProvider.from_settings(settings)
        if port == "sms":
            from app.services.providers.adapters.twilio import TwilioSmsProvider  # A6

            return TwilioSmsProvider.from_settings(settings)
        if port == "push":
            from app.services.providers.adapters.expo_push import ExpoPushProvider  # A6

            return ExpoPushProvider.from_settings(settings)

    raise ProviderConfigurationError(f"unknown port {port}", provider=port, code="unknown_port")


def _get(port: str) -> Any:
    if port not in _cache:
        _cache[port] = _build(port)
    return _cache[port]


def payment_provider() -> base.PaymentProvider:
    return _get("payment")


def fiscal_receipt_provider() -> base.FiscalReceiptProvider:
    return _get("fiscal_receipt")


def npd_status_provider() -> base.SelfEmployedStatusProvider:
    return _get("npd_status")


def sms_provider() -> base.SmsProvider:
    return _get("sms")


def push_provider() -> base.PushProvider:
    return _get("push")


def esign_provider(name: str | None = None):
    """Делегирование в уже существующий реестр e-sign; не дублировать."""
    from app.services.esign.registry import get_provider

    return get_provider(name)


def health_report() -> dict[str, dict[str, Any]]:
    """Для /health, /ready, admin и staging_readiness."""
    report: dict[str, dict[str, Any]] = {}
    for port in _PORTS:
        try:
            h = _get(port).health()
            report[port] = {"name": h.name, "mode": h.mode.value, "available": h.available, "detail": h.detail}
        except ProviderConfigurationError as exc:
            report[port] = {"name": exc.provider, "mode": None, "available": False, "detail": exc.code}
    return report


def validate_providers_runtime() -> None:
    """Вызывать из lifespan. Fail-closed: любой порт в невалидном состоянии — не стартуем."""
    for port in _PORTS:
        _get(port)  # сборка проверяет режим, окружение и обязательные credentials
    logger.info("providers runtime validated: %s", {k: v["mode"] for k, v in health_report().items()})
