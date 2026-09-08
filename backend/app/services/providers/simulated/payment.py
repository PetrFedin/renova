"""Симулятор платёжного провайдера — референсная реализация порта PaymentProvider.

Назначение: полный жизненный цикл платежа без внешнего провайдера, чтобы
GP5 (оплата → webhook → outbox → Expense → чек → спор → возврат) проходил
end-to-end через ТЕ ЖЕ код-пути, что и реальный провайдер.

Ограничение референса: состояние хранится в памяти процесса. Задача A3
обязана заменить `_InMemoryStore` на Redis-/DB-backed store с тем же
интерфейсом, чтобы симулятор работал из API и worker одновременно и
переживал рестарт. Контрактные тесты не зависят от store.

Управление из E2E / экрана payment-return.tsx:
    provider.transition(external_id, "succeed" | "cancel")  →  PaymentEvent
    затем событие подаётся в обычный webhook endpoint как body=event.raw.
Dev-endpoint для этого добавляется в A3 (только local/test).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from datetime import timezone


def utcnow() -> datetime:
    """Граница порта — aware UTC. Внутри репозитория БД хранит naive (см. app.core.timeutil);
    конвертация выполняется на стороне доменного кода, не провайдера."""
    return datetime.now(timezone.utc)
from app.services.providers import base
from app.services.providers.errors import ProviderRejected

PROVIDER_NAME = "simulated_payment"


@dataclass
class _PaymentRecord:
    external_id: str
    money: base.Money
    status: base.PaymentStatus
    description: str
    return_url: str
    idempotency_key: str
    metadata: dict[str, str]
    created_at: datetime
    refunded: Decimal = Decimal("0.00")
    refunds: dict[str, base.RefundResult] = field(default_factory=dict)  # by idempotency_key
    event_seq: int = 0


class _InMemoryStore:
    def __init__(self) -> None:
        self.by_id: dict[str, _PaymentRecord] = {}
        self.by_idem: dict[str, str] = {}

    def clear(self) -> None:
        self.by_id.clear()
        self.by_idem.clear()


_STORE = _InMemoryStore()


def reset_store() -> None:
    """Для тестов."""
    _STORE.clear()


class SimulatedPaymentProvider:
    name = PROVIDER_NAME
    mode = base.ProviderMode.SIMULATED

    def __init__(self, store: _InMemoryStore | None = None, *, confirmation_base: str = "renova://simulated-payment"):
        self._store = store or _STORE
        self._confirmation_base = confirmation_base

    # -- health --------------------------------------------------------------
    def health(self) -> base.ProviderHealth:
        return base.ProviderHealth(
            name=self.name, mode=self.mode, available=True, detail="in-process simulator",
            meta={"payments": len(self._store.by_id)},
        )

    # -- port ------------------------------------------------------------------
    async def create_payment(self, request: base.PaymentCreateRequest) -> base.PaymentCreateResult:
        existing_id = self._store.by_idem.get(request.idempotency_key)
        if existing_id:
            rec = self._store.by_id[existing_id]
            if rec.money != request.money:
                raise ProviderRejected(
                    "idempotency key reused with different amount",
                    provider=self.name, code="idempotency_conflict",
                )
            return self._create_result(rec)

        rec = _PaymentRecord(
            external_id=f"sim_{uuid.uuid4().hex[:24]}",
            money=request.money,
            status=base.PaymentStatus.PENDING,
            description=request.description[:128],
            return_url=request.return_url,
            idempotency_key=request.idempotency_key,
            metadata=dict(request.metadata),
            created_at=utcnow(),
        )
        self._store.by_id[rec.external_id] = rec
        self._store.by_idem[request.idempotency_key] = rec.external_id
        return self._create_result(rec)

    async def get_payment(self, external_id: str) -> base.PaymentState:
        rec = self._require(external_id)
        return base.PaymentState(
            external_id=rec.external_id,
            status=rec.status,
            money=rec.money,
            captured=rec.money if rec.status is base.PaymentStatus.SUCCEEDED else None,
            refunded=base.Money(rec.refunded) if rec.refunded > 0 else None,
            metadata=dict(rec.metadata),
            raw=self._raw(rec),
        )

    async def refund(self, request: base.RefundRequest) -> base.RefundResult:
        rec = self._require(request.payment_external_id)
        if request.idempotency_key in rec.refunds:
            return rec.refunds[request.idempotency_key]
        if rec.status is not base.PaymentStatus.SUCCEEDED:
            raise ProviderRejected("refund requires succeeded payment", provider=self.name, code="payment_not_succeeded")
        if rec.refunded + request.money.amount > rec.money.amount:
            raise ProviderRejected("refund exceeds captured amount", provider=self.name, code="refund_exceeds_amount")
        rec.refunded += request.money.amount
        result = base.RefundResult(
            external_id=f"simr_{uuid.uuid4().hex[:24]}",
            status="succeeded",
            money=request.money,
            raw={"payment_id": rec.external_id},
        )
        rec.refunds[request.idempotency_key] = result
        return result

    def parse_webhook(self, *, body: dict[str, Any], headers: dict[str, str], client_ip: str | None) -> base.PaymentEvent:
        # Симулятор принимает только свои собственные события (маркер + известный id).
        if body.get("provider") != self.name:
            raise ProviderRejected("foreign webhook", provider=self.name, code="webhook_rejected")
        try:
            kind = base.PaymentEventKind(body["event"])
            obj = body["object"]
            money = base.Money(Decimal(obj["amount"]["value"]), obj["amount"]["currency"])
            return base.PaymentEvent(
                kind=kind,
                event_key=f"{self.name}:{body['event_id']}",
                payment_external_id=obj["payment_id"],
                money=money,
                occurred_at=datetime.fromisoformat(body["occurred_at"]),
                refund_external_id=obj.get("refund_id"),
                metadata=dict(obj.get("metadata") or {}),
                raw=body,
            )
        except (KeyError, ValueError) as exc:
            raise ProviderRejected(f"malformed simulated webhook: {exc}", provider=self.name, code="webhook_malformed") from exc

    # -- simulator control (не часть порта) -----------------------------------
    def transition(self, external_id: str, action: str) -> base.PaymentEvent:
        """Эмуляция действия плательщика/провайдера. Возвращает событие,
        которое вызывающий обязан подать в обычный webhook endpoint."""
        rec = self._require(external_id)
        if action == "succeed":
            if rec.status is not base.PaymentStatus.PENDING:
                raise ProviderRejected("payment not pending", provider=self.name, code="invalid_transition")
            rec.status = base.PaymentStatus.SUCCEEDED
            return self._event(rec, base.PaymentEventKind.PAYMENT_SUCCEEDED)
        if action == "cancel":
            if rec.status is not base.PaymentStatus.PENDING:
                raise ProviderRejected("payment not pending", provider=self.name, code="invalid_transition")
            rec.status = base.PaymentStatus.CANCELED
            return self._event(rec, base.PaymentEventKind.PAYMENT_CANCELED)
        raise ProviderRejected(f"unknown action {action}", provider=self.name, code="invalid_transition")

    def refund_event(self, external_id: str, refund: base.RefundResult) -> base.PaymentEvent:
        rec = self._require(external_id)
        return self._event(rec, base.PaymentEventKind.REFUND_SUCCEEDED, money=refund.money, refund_id=refund.external_id)

    # -- internals -------------------------------------------------------------
    def _require(self, external_id: str) -> _PaymentRecord:
        rec = self._store.by_id.get(external_id)
        if rec is None:
            raise ProviderRejected("payment not found", provider=self.name, code="payment_not_found")
        return rec

    def _create_result(self, rec: _PaymentRecord) -> base.PaymentCreateResult:
        return base.PaymentCreateResult(
            external_id=rec.external_id,
            status=rec.status,
            confirmation_url=f"{self._confirmation_base}/{rec.external_id}?return_url={rec.return_url}",
            raw=self._raw(rec),
        )

    def _raw(self, rec: _PaymentRecord) -> dict[str, Any]:
        return {
            "id": rec.external_id,
            "status": rec.status.value,
            "amount": {"value": f"{rec.money.amount:.2f}", "currency": rec.money.currency},
            "refunded_amount": {"value": f"{rec.refunded:.2f}", "currency": rec.money.currency},
            "metadata": dict(rec.metadata),
            "description": rec.description,
            "created_at": rec.created_at.isoformat(),
        }

    def _event(self, rec: _PaymentRecord, kind: base.PaymentEventKind, *, money: base.Money | None = None, refund_id: str | None = None) -> base.PaymentEvent:
        rec.event_seq += 1
        now = utcnow()
        body = {
            "provider": self.name,
            "event": kind.value,
            "event_id": f"{rec.external_id}:{rec.event_seq}",
            "occurred_at": now.isoformat(),
            "object": {
                "payment_id": rec.external_id,
                "refund_id": refund_id,
                "amount": {"value": f"{(money or rec.money).amount:.2f}", "currency": rec.money.currency},
                "metadata": dict(rec.metadata),
            },
        }
        return self.parse_webhook(body=body, headers={}, client_ip=None)
