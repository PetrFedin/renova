"""Non-secret parsing contract for the administrative identity allowlist."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AdminIdentityConfig:
    configured_ids: tuple[str, ...]
    raw_entry_count: int
    blank_entry_count: int
    duplicate_count: int

    @property
    def configured_count(self) -> int:
        return len(self.configured_ids)

    @property
    def is_strictly_valid(self) -> bool:
        return (
            self.configured_count > 0
            and self.blank_entry_count == 0
            and self.duplicate_count == 0
        )

    def public_diagnostics(self) -> dict[str, int | bool]:
        """Return aggregate metadata only; never expose configured identifiers."""
        return {
            "configured_count": self.configured_count,
            "raw_entry_count": self.raw_entry_count,
            "blank_entry_count": self.blank_entry_count,
            "duplicate_count": self.duplicate_count,
            "strict_format_ok": self.is_strictly_valid,
        }


def parse_admin_user_ids(raw: str | None) -> AdminIdentityConfig:
    """Parse a comma-separated allowlist while retaining operator mistakes.

    Empty configuration is different from an accidental empty element. IDs are
    opaque immutable strings; UUID formatting is intentionally not imposed.
    """
    value = raw or ""
    if not value.strip():
        return AdminIdentityConfig(
            configured_ids=(),
            raw_entry_count=0,
            blank_entry_count=0,
            duplicate_count=0,
        )

    entries = value.split(",")
    normalized = [entry.strip() for entry in entries]
    non_blank = [entry for entry in normalized if entry]
    seen: set[str] = set()
    ordered_unique: list[str] = []
    duplicate_count = 0
    for entry in non_blank:
        if entry in seen:
            duplicate_count += 1
            continue
        seen.add(entry)
        ordered_unique.append(entry)

    return AdminIdentityConfig(
        configured_ids=tuple(ordered_unique),
        raw_entry_count=len(entries),
        blank_entry_count=sum(1 for entry in normalized if not entry),
        duplicate_count=duplicate_count,
    )
