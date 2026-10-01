"""Atomic account lifecycle transitions."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from sqlalchemy import delete, func, or_, select

from app.models.entities import Payment, PaymentStatus, Project, PushToken, User
from app.services import portal_link_service, session_service

RETENTION_DAYS = 30


# Деньги, которые ещё не доведены до конечного состояния.
UNSETTLED_PAYMENT_STATUSES = (
    PaymentStatus.pending,
    PaymentStatus.processing,
    PaymentStatus.paid_unverified,
    PaymentStatus.disputed,
)


class AccountDeletionBlocked(Exception):
    """ROLE-016: удаление запрещено, пока есть активные проекты или незавершённые деньги."""

    def __init__(self, blockers: list[dict[str, object]]):
        super().__init__("account_deletion_blocked")
        self.blockers = blockers


async def account_deletion_blockers(db: AsyncSession, user: User) -> list[dict[str, object]]:
    """Список причин, по которым аккаунт нельзя удалить (пусто = можно)."""
    blockers: list[dict[str, object]] = []
    in_project = or_(Project.customer_id == user.id, Project.contractor_id == user.id)

    # Активный проект с контрагентом: заказчик с исполнителем либо исполнитель на объекте.
    active = (
        await db.execute(
            select(func.count())
            .select_from(Project)
            .where(
                Project.is_archived.is_(False),
                Project.trashed_at.is_(None),
                or_(
                    (Project.customer_id == user.id) & Project.contractor_id.is_not(None),
                    Project.contractor_id == user.id,
                ),
            )
        )
    ).scalar_one()
    if active:
        blockers.append({"code": "active_projects", "count": int(active)})

    unsettled = (
        await db.execute(
            select(func.count())
            .select_from(Payment)
            .join(Project, Project.id == Payment.project_id)
            .where(in_project, Payment.status.in_(UNSETTLED_PAYMENT_STATUSES))
        )
    ).scalar_one()
    if unsettled:
        blockers.append({"code": "unsettled_payments", "count": int(unsettled)})
    return blockers


def anonymized_phone(user_id: str) -> str:
    """Return a deterministic, schema-safe replacement for a deleted phone."""
    return f"deleted-{user_id[:8]}"


async def soft_delete_account(db: AsyncSession, user: User) -> dict[str, object]:
    """Anonymize the account and revoke refresh/access sessions in one transaction."""
    if user.deleted_at is None:
        blockers = await account_deletion_blockers(db, user)
        if blockers:
            raise AccountDeletionBlocked(blockers)
    now = utc_now()
    if user.deleted_at is not None:
        deleted_at = user.deleted_at
        return {
            "ok": True,
            "soft_deleted": True,
            "already_deleted": True,
            "revoked_sessions": 0,
            "retention_until": (deleted_at + timedelta(days=RETENTION_DAYS)).isoformat() + "Z",
        }

    user.deletion_requested_at = now
    user.deleted_at = now
    user.tokens_invalid_before = now
    user.phone = anonymized_phone(user.id)
    user.full_name = "Deleted"
    user.inn = None
    user.moy_nalog_linked = False
    user.moy_nalog_status = "revoked"

    try:
        revoked = await session_service.revoke_all_user_sessions(
            db,
            user.id,
            commit=False,
        )
        # COM-017: a deleted account must not keep receiving push on its devices.
        await db.execute(delete(PushToken).where(PushToken.user_id == user.id))
        # INB-04: ссылки, выданные удалённым аккаунтом или ведущие на него, больше не работают.
        await portal_link_service.revoke_links_for_user(db, user.id)
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return {
        "ok": True,
        "soft_deleted": True,
        "already_deleted": False,
        "revoked_sessions": revoked,
        "retention_until": (now + timedelta(days=RETENTION_DAYS)).isoformat() + "Z",
    }
