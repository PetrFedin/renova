"""Database-backed administrative identity verification without ID disclosure."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import User, UserRole


@dataclass(frozen=True)
class AdminIdentityDatabaseState:
    configured_count: int
    valid_contractor_count: int
    missing_count: int
    wrong_role_count: int

    @property
    def ok(self) -> bool:
        return (
            self.configured_count > 0
            and self.valid_contractor_count == self.configured_count
            and self.missing_count == 0
            and self.wrong_role_count == 0
        )

    def public_diagnostics(self) -> dict[str, int | bool]:
        return {
            "database_ok": self.ok,
            "configured_count": self.configured_count,
            "valid_contractor_count": self.valid_contractor_count,
            "missing_count": self.missing_count,
            "wrong_role_count": self.wrong_role_count,
        }


async def inspect_admin_identities(
    db: AsyncSession,
    configured_ids: tuple[str, ...],
) -> AdminIdentityDatabaseState:
    """Count valid/missing/wrong-role identities without returning their IDs."""
    if not configured_ids:
        return AdminIdentityDatabaseState(0, 0, 0, 0)

    rows = (
        await db.execute(
            select(User.id, User.role).where(User.id.in_(configured_ids))
        )
    ).all()
    found = {str(row.id): row.role for row in rows}
    valid = sum(
        1
        for user_id in configured_ids
        if found.get(user_id) == UserRole.contractor
    )
    missing = sum(1 for user_id in configured_ids if user_id not in found)
    wrong_role = sum(
        1
        for user_id in configured_ids
        if user_id in found and found[user_id] != UserRole.contractor
    )
    return AdminIdentityDatabaseState(
        configured_count=len(configured_ids),
        valid_contractor_count=valid,
        missing_count=missing,
        wrong_role_count=wrong_role,
    )


async def assert_admin_identities(
    db: AsyncSession,
    configured_ids: tuple[str, ...],
) -> AdminIdentityDatabaseState:
    state = await inspect_admin_identities(db, configured_ids)
    if not state.ok:
        raise ValueError(
            "ADMIN_USER_IDS database verification failed: "
            f"configured_count={state.configured_count}; "
            f"valid_contractor_count={state.valid_contractor_count}; "
            f"missing_count={state.missing_count}; "
            f"wrong_role_count={state.wrong_role_count}"
        )
    return state
