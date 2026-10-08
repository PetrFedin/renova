"""Deterministic local/test NPD status simulator (PRODUCT-COMPLETION-MANDATE A5).

This adapter proves the same provider-port contract as a live NPD status lookup
without asserting external FNS truth. It is rejected by the provider registry in
staging/production.

Seed INNs are explicit so tests never infer tax status from arbitrary personal
identifiers:
- 770000000001, 770000000003 -> active
- 770000000002 -> inactive
- 770000000009 -> unknown
All other INNs -> unknown.
"""
from __future__ import annotations

from datetime import datetime

from app.core.timeutil import utc_now

from app.services.providers import base

ACTIVE_INNS = frozenset({"770000000001", "770000000003"})
INACTIVE_INNS = frozenset({"770000000002"})
UNKNOWN_INNS = frozenset({"770000000009"})


class SimulatedNpdStatusProvider:
    name = "simulated_npd"
    mode = base.ProviderMode.SIMULATED

    def health(self) -> base.ProviderHealth:
        return base.ProviderHealth(
            name=self.name,
            mode=self.mode,
            available=True,
            detail="deterministic local/test simulator",
        )

    async def check(self, inn: str, on_date: datetime) -> base.NpdStatusResult:
        canonical = (inn or "").strip()
        if len(canonical) != 12 or not canonical.isascii() or not canonical.isdigit():
            return base.NpdStatusResult(
                inn=canonical,
                status=base.NpdStatus.UNKNOWN,
                checked_at=utc_now(),
                raw={"simulated": True, "reason": "invalid_inn"},
            )
        if canonical in ACTIVE_INNS:
            status = base.NpdStatus.ACTIVE
        elif canonical in INACTIVE_INNS:
            status = base.NpdStatus.INACTIVE
        else:
            status = base.NpdStatus.UNKNOWN
        checked_at = on_date.replace(tzinfo=None) if on_date.tzinfo else on_date
        return base.NpdStatusResult(
            inn=canonical,
            status=status,
            checked_at=checked_at,
            raw={"simulated": True, "seeded": canonical in ACTIVE_INNS | INACTIVE_INNS | UNKNOWN_INNS},
        )
