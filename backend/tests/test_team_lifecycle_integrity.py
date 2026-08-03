from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import func, select

import app.models.outbox_runtime  # noqa: F401
from app.api.v1 import teams as team_api
from app.core.timeutil import utc_now
from app.models.entities import (
    DomainOutbox,
    Team,
    TeamInvite,
    TeamMember,
    User,
    UserRole,
)
from app.services import team_service as team_svc


async def seed_users(db, suffix: str):
    owner = User(
        id=f"team-owner-{suffix}",
        phone=f"+7710{sum(map(ord, suffix)) % 10_000_000:07d}",
        role=UserRole.contractor,
    )
    member = User(
        id=f"team-member-{suffix}",
        phone=f"+7720{sum(map(ord, suffix)) % 10_000_000:07d}",
        role=UserRole.contractor,
    )
    outsider = User(
        id=f"team-outsider-{suffix}",
        phone=f"+7730{sum(map(ord, suffix)) % 10_000_000:07d}",
        role=UserRole.contractor,
    )
    customer = User(
        id=f"team-customer-{suffix}",
        phone=f"+7740{sum(map(ord, suffix)) % 10_000_000:07d}",
        role=UserRole.customer,
    )
    db.add_all([owner, member, outsider, customer])
    await db.commit()
    return owner, member, outsider, customer


@pytest.mark.asyncio
async def test_my_team_prefers_owned_team_over_older_membership(db):
    owner, _, outsider, _ = await seed_users(db, "priority")
    joined_team = Team(
        id="team-priority-joined",
        name="Earlier membership",
        owner_id=outsider.id,
    )
    owned = Team(
        id="team-priority-owned",
        name="Owned team",
        owner_id=owner.id,
    )
    db.add_all(
        [
            joined_team,
            owned,
            TeamMember(
                id="team-priority-joined-member",
                team_id=joined_team.id,
                user_id=owner.id,
                role="member",
            ),
            TeamMember(
                id="team-priority-owner-member",
                team_id=owned.id,
                user_id=owner.id,
                role="owner",
            ),
        ]
    )
    await db.commit()

    selected = await team_svc.my_team(db, owner.id)
    membership = await team_svc.my_membership(db, owner.id)

    assert selected is not None and selected.id == owned.id
    assert membership is not None and membership.team_id == owned.id
    assert membership.role == "owner"


@pytest.mark.asyncio
async def test_create_team_is_replay_safe_and_repairs_owner_membership(db):
    owner, _, _, _ = await seed_users(db, "create")
    owner_id = owner.id

    first = await team_svc.create_or_get_team(db, owner_id, "Основная бригада")
    assert first.replayed is False
    team_id = first.team.id
    assert await db.scalar(
        select(func.count()).select_from(Team).where(Team.owner_id == owner_id)
    ) == 1
    assert await db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == owner_id,
        )
    ) == "owner"

    member = await db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == owner_id,
        )
    )
    assert member is not None
    await db.delete(member)
    await db.commit()

    replay = await team_svc.create_or_get_team(db, owner_id, "Другое имя")
    assert replay.replayed is True
    assert replay.team.id == team_id
    assert replay.team.name == "Основная бригада"
    assert await db.scalar(
        select(func.count()).select_from(Team).where(Team.owner_id == owner_id)
    ) == 1
    assert await db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == owner_id,
        )
    ) == "owner"

    api_replay = await team_api.create_team(
        team_api.TeamIn(name="Не создаст дубль"),
        user=await db.get(User, owner_id),
        db=db,
    )
    assert api_replay["id"] == team_id
    assert api_replay["replayed"] is True


@pytest.mark.asyncio
async def test_invite_link_creates_team_membership_and_invite_in_one_commit(db):
    owner, _, _, _ = await seed_users(db, "invite-link")
    owner_id = owner.id

    result = await team_svc.create_owner_invite(
        db,
        owner_id=owner_id,
        role="foreman",
    )

    assert result.team_replayed is False
    assert result.invite.team_id == result.team.id
    assert result.invite.role == "foreman"
    assert result.invite.used is False
    assert await db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == result.team.id,
            TeamMember.user_id == owner_id,
        )
    ) == "owner"

    second = await team_svc.create_owner_invite(
        db,
        owner_id=owner_id,
        role="viewer",
    )
    assert second.team_replayed is True
    assert second.team.id == result.team.id
    assert second.invite.id != result.invite.id
    assert await db.scalar(
        select(func.count()).select_from(Team).where(Team.owner_id == owner_id)
    ) == 1
    assert await db.scalar(
        select(func.count())
        .select_from(TeamInvite)
        .where(TeamInvite.team_id == result.team.id)
    ) == 2


@pytest.mark.asyncio
async def test_customer_join_is_rejected_without_consuming_invite(db):
    owner, _, _, customer = await seed_users(db, "customer-join")
    team = Team(id="team-customer-join", name="Team", owner_id=owner.id)
    invite = TeamInvite(
        id="team-customer-invite",
        team_id=team.id,
        token="customer-cannot-join",
        role="member",
        expires_at=utc_now() + timedelta(hours=1),
    )
    db.add_all([team, invite])
    await db.commit()
    customer_id = customer.id

    result = await team_svc.join_by_token(db, customer_id, invite.token)

    assert result["ok"] is False
    assert await db.scalar(
        select(TeamInvite.used).where(TeamInvite.id == invite.id)
    ) is False
    assert await db.scalar(
        select(func.count())
        .select_from(TeamMember)
        .where(TeamMember.user_id == customer_id)
    ) == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_join_effect_failure_rolls_back_token_and_membership(db, monkeypatch):
    owner, member, _, _ = await seed_users(db, "join-rollback")
    team = Team(id="team-join-rollback", name="Team", owner_id=owner.id)
    invite = TeamInvite(
        id="team-join-rollback-invite",
        team_id=team.id,
        token="join-effect-failure",
        role="member",
        expires_at=utc_now() + timedelta(hours=1),
    )
    db.add_all([team, invite])
    await db.commit()
    member_id = member.id
    invite_id = invite.id

    async def fail_notification(*_args, **_kwargs):
        raise RuntimeError("synthetic_team_join_effect_failure")

    monkeypatch.setattr(team_svc, "_enqueue_notification", fail_notification)
    with pytest.raises(RuntimeError, match="synthetic_team_join_effect_failure"):
        await team_svc.join_by_token(db, member_id, invite.token)

    assert await db.scalar(
        select(TeamInvite.used).where(TeamInvite.id == invite_id)
    ) is False
    assert await db.scalar(
        select(func.count())
        .select_from(TeamMember)
        .where(TeamMember.team_id == team.id, TeamMember.user_id == member_id)
    ) == 0
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_invite_phone_is_owner_scoped_and_atomic(db, monkeypatch):
    owner, member, outsider, _ = await seed_users(db, "phone-owner")
    created = await team_svc.create_or_get_team(db, owner.id, "Owner team")
    team_id = created.team.id
    owner_id = owner.id
    member_id = member.id

    with pytest.raises(ValueError, match="team_not_found"):
        await team_svc.invite_phone_as_owner(
            db,
            owner_id=outsider.id,
            phone=member.phone,
            role="member",
        )

    owner = await db.get(User, owner_id)
    assert owner is not None
    result = await team_svc.invite_phone_as_owner(
        db,
        owner_id=owner.id,
        phone=member.phone,
        role="viewer",
    )
    assert result == {"ok": True, "user_id": member_id}
    assert await db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == member_id,
        )
    ) == "viewer"
    assert await db.scalar(
        select(func.count())
        .select_from(DomainOutbox)
        .where(DomainOutbox.aggregate_id == team_id)
    ) == 1


@pytest.mark.asyncio
async def test_role_change_is_owner_only_and_rolls_back_effect_failure(db, monkeypatch):
    owner, member, outsider, _ = await seed_users(db, "role")
    created = await team_svc.create_or_get_team(db, owner.id, "Role team")
    team_id = created.team.id
    db.add(TeamMember(team_id=team_id, user_id=member.id, role="member"))
    await db.commit()
    owner_id = owner.id
    member_id = member.id

    assert await team_svc.set_member_role(
        db,
        team_id,
        outsider.id,
        member_id,
        "foreman",
    ) is False
    assert await team_svc.set_member_role(
        db,
        team_id,
        owner_id,
        owner_id,
        "viewer",
    ) is False
    assert await db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == member_id,
        )
    ) == "member"

    async def fail_notification(*_args, **_kwargs):
        raise RuntimeError("synthetic_team_role_effect_failure")

    monkeypatch.setattr(team_svc, "_enqueue_notification", fail_notification)
    with pytest.raises(RuntimeError, match="synthetic_team_role_effect_failure"):
        await team_svc.set_member_role(
            db,
            team_id,
            owner_id,
            member_id,
            "foreman",
        )

    assert await db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == member_id,
        )
    ) == "member"
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_list_members_uses_stable_response_shape(db):
    owner, member, _, _ = await seed_users(db, "members")
    team = Team(id="team-list-members", name="List", owner_id=owner.id)
    db.add_all(
        [
            team,
            TeamMember(team_id=team.id, user_id=owner.id, role="owner"),
            TeamMember(team_id=team.id, user_id=member.id, role="foreman"),
        ]
    )
    await db.commit()

    rows = await team_svc.list_members(db, team.id)

    assert rows == [
        {"user_id": owner.id, "phone": owner.phone, "role": "owner"},
        {"user_id": member.id, "phone": member.phone, "role": "foreman"},
    ]
