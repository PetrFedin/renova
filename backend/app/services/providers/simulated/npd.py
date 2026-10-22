"""Симулятор статуса самозанятого (порт SelfEmployedStatusProvider).

    ИНН заканчивается на 00 → INACTIVE (не плательщик НПД)
    ИНН заканчивается на 99 → UNKNOWN  (сервис не ответил)
    иначе                    → ACTIVE

Запрещён в staging/production политикой registry.
"""
from __future__ import annotations

from datetime import datetime

from app.services.providers import base

PROVIDER_NAME = "simulated_npd_status"


class SimulatedNpdStatusProvider:
    name = PROVIDER_NAME
    mode = base.ProviderMode.SIMULATED

    def health(self) -> base.ProviderHealth:
        return base.ProviderHealth(name=self.name, mode=self.mode, available=True, detail="deterministic by INN suffix")

    async def check(self, inn: str, on_date: datetime) -> base.NpdStatusResult:
        digits = "".join(ch for ch in str(inn) if ch.isdigit())
        if digits.endswith("00"):
            status = base.NpdStatus.INACTIVE
        elif digits.endswith("99"):
            status = base.NpdStatus.UNKNOWN
        else:
            status = base.NpdStatus.ACTIVE
        return base.NpdStatusResult(inn=digits, status=status, checked_at=on_date, raw={"provider": self.name})
