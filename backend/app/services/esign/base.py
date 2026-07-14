"""Контракт e-sign провайдера.

Зачем отдельный интерфейс:
- in_app сегодня; Kontur/Госуслуги позже без переписывания API sign.
- Единый SignResult → DocumentSignature (+ meta_json).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class SignRequest:
    document_id: str
    version_id: str
    signer_user_id: str
    signer_role: str
    content_hash: str | None = None
    title: str | None = None
    mime_type: str | None = None


@dataclass
class SignResult:
    status: str  # signed | pending | failed | unavailable
    provider_name: str
    external_id: str | None = None
    signature_type: str = "in_app"
    meta: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class ESignProvider(Protocol):
    name: str
    display_name: str

    def is_available(self) -> bool:
        """True если провайдер можно вызвать (ключи / аккредитация)."""
        ...

    async def create_signature(self, request: SignRequest) -> SignResult:
        ...
