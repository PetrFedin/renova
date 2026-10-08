"""Real NPD status adapter backed by the existing public FNS client."""
from __future__ import annotations

from datetime import datetime, timezone

from app.services.fns.status_npd import _check_taxpayer_npd_status_live
from app.services.providers import base

PROVIDER_NAME = "fns_npd"


class FnsNpdStatusProvider:
    name = PROVIDER_NAME
    mode = base.ProviderMode.REAL

    @classmethod
    def from_settings(cls, _settings):
        return cls()

    def health(self) -> base.ProviderHealth:
        return base.ProviderHealth(
            name=self.name,
            mode=self.mode,
            available=True,
            detail="public FNS NPD status API",
        )

    async def check(self, inn: str, on_date: datetime) -> base.NpdStatusResult:
        result = await _check_taxpayer_npd_status_live(inn, on_date.date())
        checked_at = on_date if on_date.tzinfo else on_date.replace(tzinfo=timezone.utc)
        return base.NpdStatusResult(
            inn=result["inn"],
            status=base.NpdStatus.ACTIVE if result["is_npd"] else base.NpdStatus.INACTIVE,
            checked_at=checked_at.astimezone(timezone.utc),
            raw=result,
        )
