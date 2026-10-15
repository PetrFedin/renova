"""Persistent simulated PaymentProvider for local/test Golden Paths.

Canonical local development uses Redis so simulated provider state survives API
restart and is shared with worker processes. Isolated unit tests without
REDIS_URL keep an in-memory store with the same interface.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Protocol

from app.core.config import settings
from app.services.providers import base
from app.services.providers.errors import ProviderRejected

PROVIDER_NAME = "simulated_payment"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    refunds: dict[str, base.RefundResult] = field(default_factory=dict)
    event_seq: int = 0


class _Store(Protocol):
    def get(self, external_id: str) -> _PaymentRecord | None: ...
    def get_by_idempotency(self, key: str) -> _PaymentRecord | None: ...
    def put(self, record: _PaymentRecord) -> None: ...
    def clear(self) -> None: ...
    def count(self) -> int: ...


class _InMemoryStore:
    def __init__(self) -> None:
        self.by_id: dict[str, _PaymentRecord] = {}
        self.by_idem: dict[str, str] = {}

    def get(self, external_id: str) -> _PaymentRecord | None:
        return self.by_id.get(external_id)

    def get_by_idempotency(self, key: str) -> _PaymentRecord | None:
        external_id = self.by_idem.get(key)
        return self.by_id.get(external_id) if external_id else None

    def put(self, record: _PaymentRecord) -> None:
        self.by_id[record.external_id] = record
        self.by_idem[record.idempotency_key] = record.external_id

    def clear(self) -> None:
        self.by_id.clear()
        self.by_idem.clear()

    def count(self) -> int:
        return len(self.by_id)


def _refund_to_dict(value: base.RefundResult) -> dict[str, Any]:
    return {
        "external_id": value.external_id,
        "status": value.status,
        "amount": str(value.money.amount),
        "currency": value.money.currency,
        "raw": value.raw,
    }


def _refund_from_dict(value: dict[str, Any]) -> base.RefundResult:
    return base.RefundResult(
        external_id=str(value["external_id"]),
        status=str(value["status"]),
        money=base.Money(Decimal(str(value["amount"])), str(value.get("currency") or "RUB")),
        raw=dict(value.get("raw") or {}),
    )


def _record_to_json(record: _PaymentRecord) -> str:
    return json.dumps(
        {
            "external_id": record.external_id,
            "amount": str(record.money.amount),
            "currency": record.money.currency,
            "status": record.status.value,
            "description": record.description,
            "return_url": record.return_url,
            "idempotency_key": record.idempotency_key,
            "metadata": record.metadata,
            "created_at": record.created_at.isoformat(),
            "refunded": str(record.refunded),
            "refunds": {key: _refund_to_dict(value) for key, value in record.refunds.items()},
            "event_seq": record.event_seq,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _record_from_json(raw: str) -> _PaymentRecord:
    value = json.loads(raw)
    return _PaymentRecord(
        external_id=str(value["external_id"]),
        money=base.Money(Decimal(str(value["amount"])), str(value.get("currency") or "RUB")),
        status=base.PaymentStatus(str(value["status"])),
        description=str(value.get("description") or ""),
        return_url=str(value.get("return_url") or ""),
        idempotency_key=str(value["idempotency_key"]),
        metadata={str(k): str(v) for k, v in dict(value.get("metadata") or {}).items()},
        created_at=datetime.fromisoformat(str(value["created_at"])),
        refunded=Decimal(str(value.get("refunded") or "0.00")),
        refunds={str(k): _refund_from_dict(v) for k, v in dict(value.get("refunds") or {}).items()},
        event_seq=int(value.get("event_seq") or 0),
    )


class _RedisStore:
    RECORDS_KEY = "renova:simulated-payment:records"
    IDEMPOTENCY_KEY = "renova:simulated-payment:idempotency"

    def __init__(self, redis_url: str) -> None:
        from redis import Redis

        self._redis = Redis.from_url(redis_url, decode_responses=True)

    def get(self, external_id: str) -> _PaymentRecord | None:
        raw = self._redis.hget(self.RECORDS_KEY, external_id)
        return _record_from_json(raw) if raw else None

    def get_by_idempotency(self, key: str) -> _PaymentRecord | None:
        external_id = self._redis.hget(self.IDEMPOTENCY_KEY, key)
        return self.get(external_id) if external_id else None

    def put(self, record: _PaymentRecord) -> None:
        pipe = self._redis.pipeline(transaction=True)
        pipe.hset(self.RECORDS_KEY, record.external_id, _record_to_json(record))
        pipe.hset(self.IDEMPOTENCY_KEY, record.idempotency_key, record.external_id)
        pipe.execute()

    def clear(self) -> None:
        self._redis.delete(self.RECORDS_KEY, self.IDEMPOTENCY_KEY)

    def count(self) -> int:
        return int(self._redis.hlen(self.RECORDS_KEY))


_MEMORY_STORE = _InMemoryStore()


def reset_store() -> None:
    """Unit-test reset for the process-local fallback store."""
    _MEMORY_STORE.clear()


def _default_store() -> _Store:
    redis_url = (settings.redis_url or "").strip()
    if redis_url and settings.normalized_environment in {"development", "test"}:
        return _RedisStore(redis_url)
    return _MEMORY_STORE


class SimulatedPaymentProvider:
    name = PROVIDER_NAME
    mode = base.ProviderMode.SIMULATED

    def __init__(self, store: _Store | None = None, *, confirmation_base: str = "renova://simulated-payment"):
        self._store = store or _default_store()
        self._confirmation_base = confirmation_base

    def health(self) -> base.ProviderHealth:
        return base.ProviderHealth(
            name=self.name,
            mode=self.mode,
            available=True,
            detail="redis-backed simulator" if isinstance(self._store, _RedisStore) else "isolated in-memory simulator",
            meta={"payments": self._store.count()},
        )

    async def create_payment(self, request: base.PaymentCreateRequest) -> base.PaymentCreateResult:
        existing = self._store.get_by_idempotency(request.idempotency_key)
        if existing:
            if existing.money != request.money:
                raise ProviderRejected(
                    "idempotency key reused with different amount",
                    provider=self.name,
                    code="idempotency_conflict",
                )
            return self._create_result(existing)

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
        self._store.put(rec)
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
        self._store.put(rec)
        return result

    def parse_webhook(self, *, body: dict[str, Any], headers: dict[str, str], client_ip: str | None) -> base.PaymentEvent:
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
            raise ProviderRejected(
                f"malformed simulated webhook: {exc}",
                provider=self.name,
                code="webhook_malformed",
            ) from exc

    def transition(self, external_id: str, action: str) -> base.PaymentEvent:
        rec = self._require(external_id)
        if action == "succeed":
            if rec.status is not base.PaymentStatus.PENDING:
                raise ProviderRejected("payment not pending", provider=self.name, code="invalid_transition")
            rec.status = base.PaymentStatus.SUCCEEDED
            self._store.put(rec)
            return self._event(rec, base.PaymentEventKind.PAYMENT_SUCCEEDED)
        if action == "cancel":
            if rec.status is not base.PaymentStatus.PENDING:
                raise ProviderRejected("payment not pending", provider=self.name, code="invalid_transition")
            rec.status = base.PaymentStatus.CANCELED
            self._store.put(rec)
            return self._event(rec, base.PaymentEventKind.PAYMENT_CANCELED)
        raise ProviderRejected(f"unknown action {action}", provider=self.name, code="invalid_transition")

    def refund_event(self, external_id: str, refund: base.RefundResult) -> base.PaymentEvent:
        rec = self._require(external_id)
        return self._event(
            rec,
            base.PaymentEventKind.REFUND_SUCCEEDED,
            money=refund.money,
            refund_id=refund.external_id,
        )

    def _require(self, external_id: str) -> _PaymentRecord:
        rec = self._store.get(external_id)
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

    def _event(
        self,
        rec: _PaymentRecord,
        kind: base.PaymentEventKind,
        *,
        money: base.Money | None = None,
        refund_id: str | None = None,
    ) -> base.PaymentEvent:
        rec.event_seq += 1
        self._store.put(rec)
        now = utcnow()
        event_money = money or rec.money
        if kind is base.PaymentEventKind.REFUND_SUCCEEDED:
            obj = {
                "id": refund_id,
                "status": "succeeded",
                "payment_id": rec.external_id,
                "refund_id": refund_id,
                "amount": {"value": f"{event_money.amount:.2f}", "currency": event_money.currency},
                "metadata": dict(rec.metadata),
            }
        else:
            obj = {
                "id": rec.external_id,
                "payment_id": rec.external_id,
                "refund_id": None,
                "status": "succeeded" if kind is base.PaymentEventKind.PAYMENT_SUCCEEDED else "canceled",
                "amount": {"value": f"{event_money.amount:.2f}", "currency": event_money.currency},
                "metadata": dict(rec.metadata),
            }
            if kind is base.PaymentEventKind.PAYMENT_CANCELED:
                obj["cancellation_details"] = {"reason": "simulated_cancel"}
        body = {
            "provider": self.name,
            "event": kind.value,
            "event_id": f"{rec.external_id}:{rec.event_seq}",
            "occurred_at": now.isoformat(),
            "object": obj,
        }
        return self.parse_webhook(body=body, headers={}, client_ip=None)
