from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import Team, TeamInvite, TeamMember, User, UserRole
from app.services import outbox_service as outbox
from app.services import team_service


def _invalid_link() -> dict[str, object]:
    return {"ok": False, "message": "Ссылка недействительна"}


async def _locked_user(db: AsyncSession, user_id: str) -> User | None:
    query = select(User).where(User.id == user_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _locked_team(db: AsyncSession, team_id: str) -> Team | None:
    query = select(Team).where(Team.id == team_id)
    try:
        query = query.with_for_update()
    except Exception:
        pass
    return (await db.execute(query)).scalar_one_or_none()


async def _committed_replay_team_id(
    db: AsyncSession,
    *,
    user_id: str,
    token: str,
) -> str | None:
    """Return the invite team only when the same user is already a member.

    A consumed token alone is never accepted. The authenticated user must have a
    durable membership in that exact team, so another contractor cannot reuse it.
    """
    return await db.scalar(
        select(TeamInvite.team_id)
        .join(Team, Team.id == TeamInvite.team_id)
        .join(TeamMember, TeamMember.team_id == TeamInvite.team_id)
        .where(
            TeamInvite.token == token,
            TeamInvite.used.is_(True),
            TeamMember.user_id == user_id,
        )
    )


async def _enqueue_owner_notification(
    db: AsyncSession,
    *,
    team: Team,
    user: User,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="team",
        aggregate_id=team.id,
        event_type=outbox.NOTIFICATION_EVENT,
        payload={
            "user_id": team.owner_id,
            "project_id": None,
            "notification_type": "chat_message",
            "title": "Новый участник бригады",
            "body": f"Исполнитель {user.phone} присоединился к «{team.name}»",
            "link_path": "/(contractor)/(tabs)/profile",
            "return_to": "/(contractor)/(tabs)/",
        },
    )


async def _dispatch_join_notification(db: AsyncSession) -> None:
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="team.join", limit=10)


async def join_by_token(
    db: AsyncSession,
    user_id: str,
    token: str,
) -> dict[str, object]:
    """Atomically consume an invite and make the committed result retry-safe.

    The first successful request claims the unused invite, creates membership and
    prepares the owner notification in one transaction. If the response is lost,
    a retry by the same authenticated user is reconciled against durable membership
    and returns success. A different user still receives an invalid-link response.
    """
    normalized = token.strip()
    if not normalized:
        return _invalid_link()

    user = await _locked_user(db, user_id)
    if user is None or user.role != UserRole.contractor:
        await db.rollback()
        return {
            "ok": False,
            "message": "Только исполнитель может вступить в бригаду",
        }

    claimed = await db.execute(
        update(TeamInvite)
        .where(
            TeamInvite.token == normalized,
            TeamInvite.used.is_(False),
            TeamInvite.expires_at >= utc_now(),
        )
        .values(used=True)
        .returning(TeamInvite.team_id, TeamInvite.role)
    )
    row = claimed.first()

    if row is None:
        # End the failed claim transaction before reading the committed winner.
        # Without this boundary a concurrent commit can remain invisible in the
        # current transaction snapshot on databases with snapshot isolation.
        await db.rollback()
        replay_team_id = await _committed_replay_team_id(
            db,
            user_id=user_id,
            token=normalized,
        )
        await db.rollback()
        if replay_team_id is not None:
            return {
                "ok": True,
                "team_id": replay_team_id,
                "replayed": True,
            }
        return _invalid_link()

    team_id, role = row
    team = await _locked_team(db, team_id)
    if team is None:
        await db.rollback()
        return _invalid_link()

    try:
        _member, created = await team_service.ensure_team_membership(
            db,
            team_id=team_id,
            user_id=user_id,
            role=role,
        )
        if created:
            await _enqueue_owner_notification(db, team=team, user=user)
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    if created:
        await _dispatch_join_notification(db)

    return {
        "ok": True,
        "team_id": team_id,
        "replayed": not created,
    }
