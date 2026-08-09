from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import func, select

import app.models.outbox_runtime  # noqa: F401
from app.api.v1 import teams as team_api
from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox, Team, TeamInvite, TeamMember, User, UserRole
from app.services import team_invite_join_service as join_svc


async def _seed_invite(db, *, token: str, expired: bool = False):
    owner = User(
        id=f"owner-{token}",
        phone="+79995550101",
        role=UserRole.contractor,
    )
    member = User(
        id=f"member-{token}",
        phone="+79995550102",
        role=UserRole.contractor,
    )
    outsider = User(
        id=f"outsider-{token}",
        phone="+79995550103",
        role=UserRole.contractor,
    )
    team = Team(
        id=f"team-{token}",
        name="Retry-safe team",
        owner_id=owner.id,
    )
    invite = TeamInvite(
        id=f"invite-{token}",
        team_id=team.id,
        token=token,
        role="member",
        expires_at=utc_now() + (timedelta(minutes=-1) if expired else timedelta(hours=1)),
    )
    db.add_all([owner, member, outsider, team, invite])
    await db.commit()
    return owner, member, outsider, team, invite


@pytest.mark.asyncio
async def test_same_user_retry_reconciles_committed_join_without_duplicate_effects(db, monkeypatch):
    _owner, member, outsider, team, invite = await _seed_invite(db, token="lost-response")
    member_id = member.id
    outsider_id = outsider.id
    team_id = team.id
    invite_token = invite.token

    async def no_inline_dispatch(_db):
        return None

    monkeypatch.setattr(join_svc, "_dispatch_join_notification", no_inline_dispatch)

    first = await join_svc.join_by_token(db, member_id, invite_token)
    replay = await join_svc.join_by_token(db, member_id, invite_token)
    stolen_replay = await join_svc.join_by_token(db, outsider_id, invite_token)

    assert first == {"ok": True, "team_id": team_id, "replayed": False}
    assert replay == {"ok": True, "team_id": team_id, "replayed": True}
    assert stolen_replay == {"ok": False, "message": "Ссылка недействительна"}
    assert await db.scalar(
        select(func.count())
        .select_from(TeamMember)
        .where(TeamMember.team_id == team_id, TeamMember.user_id == member_id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(TeamMember)
        .where(TeamMember.team_id == team_id, TeamMember.user_id == outsider_id)
    ) == 0
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == team_id)
    ) == 1


@pytest.mark.asyncio
async def test_expired_unused_invite_never_replays_from_unrelated_existing_membership(db):
    _owner, member, _outsider, team, invite = await _seed_invite(
        db,
        token="expired-membership",
        expired=True,
    )
    member_id = member.id
    team_id = team.id
    invite_id = invite.id
    invite_token = invite.token
    db.add(TeamMember(team_id=team_id, user_id=member_id, role="member"))
    await db.commit()

    result = await join_svc.join_by_token(db, member_id, invite_token)

    assert result == {"ok": False, "message": "Ссылка недействительна"}
    assert await db.scalar(select(TeamInvite.used).where(TeamInvite.id == invite_id)) is False


@pytest.mark.asyncio
async def test_route_uses_replay_safe_join_service(db, monkeypatch):
    _owner, member, _outsider, team, invite = await _seed_invite(db, token="route-service")
    member_id = member.id
    team_id = team.id
    invite_token = invite.token
    captured: dict[str, str] = {}

    async def fake_join(_db, user_id: str, token: str):
        captured["user_id"] = user_id
        captured["token"] = token
        return {"ok": True, "team_id": team_id, "replayed": True}

    monkeypatch.setattr(join_svc, "join_by_token", fake_join)

    result = await team_api.join(
        team_api.JoinIn(token=invite_token),
        user=member,
        db=db,
    )

    assert result == {"ok": True, "team_id": team_id, "replayed": True}
    assert captured == {"user_id": member_id, "token": invite_token}


@pytest.mark.asyncio
async def test_join_effect_failure_rolls_back_invite_membership_and_outbox(db, monkeypatch):
    _owner, member, _outsider, team, invite = await _seed_invite(db, token="effect-failure")
    member_id = member.id
    team_id = team.id
    invite_id = invite.id
    invite_token = invite.token

    async def fail_notification(*_args, **_kwargs):
        raise RuntimeError("synthetic_join_notification_failure")

    monkeypatch.setattr(join_svc, "_enqueue_owner_notification", fail_notification)

    with pytest.raises(RuntimeError, match="synthetic_join_notification_failure"):
        await join_svc.join_by_token(db, member_id, invite_token)

    assert await db.scalar(select(TeamInvite.used).where(TeamInvite.id == invite_id)) is False
    assert await db.scalar(
        select(func.count())
        .select_from(TeamMember)
        .where(TeamMember.team_id == team_id, TeamMember.user_id == member_id)
    ) == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0
