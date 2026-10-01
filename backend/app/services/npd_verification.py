"""Проверка владения ИНН самозанятого (MNY-029, APIA-008).

Ответ ФНС «ИНН является плательщиком НПД» (``app.services.fns.status_npd``) подтверждает лишь статус
ИНН, но не то, что этим ИНН владеет вошедший пользователь. Здесь — интерфейс провайдера проверки
владения и два честных провайдера без внешних API:

* ``none``   — владение проверить нечем: статус всегда ``unverified``;
* ``manual`` — заявка ждёт ручной проверки оператором: ``pending_manual``; сам провайдер
  ``npd_verified`` не выставляет.

Реальный провайдер (OAuth «Мой налог» с профилем налогоплательщика, Госуслуги) добавляется как ещё одна
реализация ``NpdOwnershipProvider`` и регистрируется в ``PROVIDERS`` — поведение API менять не нужно.
Флаг ``NPD_OWNERSHIP_ENFORCED`` включает режим, в котором ``npd_verified`` истинен только при
``verified`` от провайдера.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from app.core.config import settings

UNVERIFIED = "unverified"
PENDING_MANUAL = "pending_manual"
VERIFIED = "verified"
REJECTED = "rejected"


@dataclass(frozen=True)
class OwnershipDecision:
    status: str  # unverified | pending_manual | verified | rejected
    provider: str
    message: str

    @property
    def proven(self) -> bool:
        return self.status == VERIFIED


class NpdOwnershipProvider(Protocol):
    name: str

    async def verify(self, *, user_id: str | None, inn: str) -> OwnershipDecision: ...


class NoneProvider:
    name = "none"

    async def verify(self, *, user_id: str | None, inn: str) -> OwnershipDecision:
        return OwnershipDecision(
            UNVERIFIED,
            self.name,
            "Владение ИНН не проверено: статус ФНС не доказывает, что ИНН принадлежит вам.",
        )


class ManualReviewProvider:
    name = "manual"

    async def verify(self, *, user_id: str | None, inn: str) -> OwnershipDecision:
        return OwnershipDecision(
            PENDING_MANUAL,
            self.name,
            "Владение ИНН ожидает ручной проверки оператором; до подтверждения статус не присваивается.",
        )


PROVIDERS: dict[str, NpdOwnershipProvider] = {
    NoneProvider.name: NoneProvider(),
    ManualReviewProvider.name: ManualReviewProvider(),
}


def get_provider() -> NpdOwnershipProvider:
    """Неизвестное имя в конфиге — fail-closed в ``none`` (никогда не «verified»)."""
    return PROVIDERS.get((settings.npd_ownership_provider or "none").strip().lower(), PROVIDERS["none"])


async def ownership_decision(*, user_id: str | None, inn: str) -> OwnershipDecision:
    try:
        return await get_provider().verify(user_id=user_id, inn=inn)
    except Exception:  # провайдер упал — честно «не проверено», а не «подтверждено»
        return OwnershipDecision(UNVERIFIED, get_provider().name, "Проверка владения ИНН недоступна.")


def npd_flag(fns_is_npd: bool, decision: OwnershipDecision) -> bool:
    """Значение ``User.npd_verified``: с флагом — только при доказанном владении, без — статус ФНС."""
    if settings.npd_ownership_enforced:
        return bool(fns_is_npd) and decision.proven
    return bool(fns_is_npd)


async def npd_flag_for_inn(*, user_id: str | None, inn: str, fns_is_npd: bool) -> bool:
    decision = await ownership_decision(user_id=user_id, inn=inn)
    return npd_flag(fns_is_npd, decision)


def response_fields(fns_is_npd: bool, decision: OwnershipDecision) -> dict[str, Any]:
    if settings.npd_ownership_enforced and fns_is_npd and not decision.proven:
        badge = decision.status if decision.status != UNVERIFIED else "unverified"
    else:
        badge = "verified" if fns_is_npd else "not_npd"
    return {
        "badge": badge,
        "ownership_status": decision.status,
        "ownership_provider": decision.provider,
        "ownership_message": decision.message,
    }
