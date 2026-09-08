"""Порты внешних провайдеров.

Правила (см. PRODUCT-COMPLETION-MANDATE.md §3):
- доменный код импортирует только этот модуль и `registry`;
- ни один dataclass здесь не содержит полей, специфичных для одного провайдера —
  такие данные кладутся в `raw`/`meta`;
- деньги — `Decimal` в рублях с 2 знаками; никаких float на границе порта;
- время — timezone-aware UTC (`app.core.timeutil`);
- каждая мутирующая операция принимает `idempotency_key`; адаптер обязан
  гарантировать, что повторный вызов с тем же ключом не создаёт вторую
  сущность у провайдера (или бросает ProviderAmbiguous, если не может это гарантировать).

Существующий `app.services.esign.base.ESignProvider` уже соответствует этим
принципам и НЕ дублируется здесь; `registry.esign_provider()` делегирует в
`esign.registry`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable


class ProviderMode(StrEnum):
    OFF = "off"
    SIMULATED = "simulated"
    REAL = "real"


# ---------------------------------------------------------------------------
# Общие типы
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str = "RUB"

    def __post_init__(self) -> None:
        if self.amount != self.amount.quantize(Decimal("0.01")):
            raise ValueError("Money.amount must have at most 2 decimal places")
        if self.amount < 0:
            raise ValueError("Money.amount must be non-negative")


@dataclass
class ProviderHealth:
    name: str
    mode: ProviderMode
    available: bool
    detail: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


class PaymentStatus(StrEnum):
    PENDING = "pending"  # создан, ждёт действия плательщика
    WAITING_FOR_CAPTURE = "waiting_for_capture"
    SUCCEEDED = "succeeded"
    CANCELED = "canceled"


class PaymentEventKind(StrEnum):
    PAYMENT_PENDING = "payment.pending"
    PAYMENT_SUCCEEDED = "payment.succeeded"
    PAYMENT_CANCELED = "payment.canceled"
    REFUND_SUCCEEDED = "refund.succeeded"


@dataclass(frozen=True)
class PaymentCreateRequest:
    money: Money
    description: str
    return_url: str
    idempotency_key: str
    # Стабильные внутренние идентификаторы для сопоставления при webhook/reconciliation.
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PaymentCreateResult:
    external_id: str
    status: PaymentStatus
    confirmation_url: str | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PaymentState:
    external_id: str
    status: PaymentStatus
    money: Money
    captured: Money | None = None
    refunded: Money | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RefundRequest:
    payment_external_id: str
    money: Money
    idempotency_key: str
    reason: str | None = None


@dataclass(frozen=True)
class RefundResult:
    external_id: str
    status: str  # succeeded | pending | canceled
    money: Money
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PaymentEvent:
    """Внутренний нормализованный webhook. Единственное, что видит `process_webhook`."""

    kind: PaymentEventKind
    event_key: str  # стабильный ключ дедупликации (provider + event id)
    payment_external_id: str
    money: Money
    occurred_at: datetime
    refund_external_id: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class PaymentProvider(Protocol):
    name: str
    mode: ProviderMode

    def health(self) -> ProviderHealth: ...

    async def create_payment(self, request: PaymentCreateRequest) -> PaymentCreateResult: ...

    async def get_payment(self, external_id: str) -> PaymentState:
        """Authoritative read. Используется reconciliation, не UI."""
        ...

    async def refund(self, request: RefundRequest) -> RefundResult: ...

    def parse_webhook(self, *, body: dict[str, Any], headers: dict[str, str], client_ip: str | None) -> PaymentEvent:
        """Проверяет подлинность (IP/подпись) и нормализует. Бросает ProviderRejected при невалидном."""
        ...


# ---------------------------------------------------------------------------
# Фискальные чеки (ФНС)
# ---------------------------------------------------------------------------


class ReceiptVerdict(StrEnum):
    VALID = "valid"
    NOT_FOUND = "not_found"
    AMOUNT_MISMATCH = "amount_mismatch"
    UNAVAILABLE = "unavailable"  # провайдер не ответил; можно повторить


@dataclass(frozen=True)
class ReceiptQuery:
    fn: str  # номер ФН
    fd: str  # номер ФД
    fp: str  # ФПД
    money: Money
    issued_at: datetime
    operation_type: int = 1
    raw_qr: str | None = None


@dataclass(frozen=True)
class ReceiptVerification:
    verdict: ReceiptVerdict
    provider_amount: Money | None = None
    seller_inn: str | None = None
    seller_name: str | None = None
    items: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class FiscalReceiptProvider(Protocol):
    name: str
    mode: ProviderMode

    def health(self) -> ProviderHealth: ...

    async def verify(self, query: ReceiptQuery) -> ReceiptVerification: ...


# ---------------------------------------------------------------------------
# Статус самозанятого (НПД)
# ---------------------------------------------------------------------------


class NpdStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class NpdStatusResult:
    inn: str
    status: NpdStatus
    checked_at: datetime
    raw: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class SelfEmployedStatusProvider(Protocol):
    name: str
    mode: ProviderMode

    def health(self) -> ProviderHealth: ...

    async def check(self, inn: str, on_date: datetime) -> NpdStatusResult: ...


# ---------------------------------------------------------------------------
# Исходящие сообщения: SMS / Push
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SmsMessage:
    phone_e164: str
    text: str
    idempotency_key: str


@dataclass(frozen=True)
class SmsDelivery:
    external_id: str | None
    accepted: bool
    raw: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class SmsProvider(Protocol):
    name: str
    mode: ProviderMode

    def health(self) -> ProviderHealth: ...

    async def send(self, message: SmsMessage) -> SmsDelivery: ...


@dataclass(frozen=True)
class PushMessage:
    token: str
    title: str
    body: str
    data: dict[str, Any]
    delivery_id: str  # stable_push_delivery_id(...) из push_service


@dataclass(frozen=True)
class PushTicket:
    delivery_id: str
    ticket_id: str | None
    accepted: bool
    error_code: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PushReceipt:
    ticket_id: str
    status: str  # ok | error
    error_code: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class PushProvider(Protocol):
    name: str
    mode: ProviderMode

    def health(self) -> ProviderHealth: ...

    async def send(self, messages: list[PushMessage]) -> list[PushTicket]: ...

    async def receipts(self, ticket_ids: list[str]) -> list[PushReceipt]: ...
