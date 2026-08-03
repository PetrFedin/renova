from __future__ import annotations

import asyncio
from datetime import timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import DomainOutbox, Team, TeamInvite, TeamMember, User, UserRole
from app.services import team_service as team_svc


@pytest_asyncio.fixture
async def invite_store(tmp_path):
    db_path = tmp_path / "team-invite.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"timeout": 30},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield engine, session_factory
    await engine.dispose()


async def _seed(session_factory, *, token: str = "single-use", expired: bool = False):
    async with session_factory() as db:
        owner = User(id="invite-owner", phone="+79990001101", role=UserRole.contractor)
        first = User(id="invite-first", phone="+79990001102", role=UserRole.contractor)
        second = User(id="invite-second", phone="+79990001103", role=UserRole.contractor)
        team = Team(id="invite-team", name="Atomic team", owner_id=owner.id)
        invite = TeamInvite(
            id="invite-row",
            team_id=team.id,
            token=token,
            role="member",
            expires_at=utc_now() + (timedelta(hours=-1) if expired else timedelta(hours=1)),
        )
        db.add_all([owner, first, second, team, invite])
        await db.commit()
    return owner, first, second, team


@pytest.mark.asyncio
async def test_single_use_invite_has_exactly_one_concurrent_winner(invite_store):
    _engine, session_factory = invite_store
    _owner, first, second, team = await _seed(session_factory)

    async def redeem(user_id: str):
        async with session_factory() as db:
            return await team_svc.join_by_token(db, user_id, "single-use")

    results = await asyncio.gather(redeem(first.id), redeem(second.id))

    assert sum(1 for result in results if result["ok"] is True) == 1
    assert sum(1 for result in results if result["ok"] is False) == 1
    async with session_factory() as db:
        invite = await db.scalar(select(TeamInvite).where(TeamInvite.token == "single-use"))
        members = await db.scalar(
            select(func.count())
            .select_from(TeamMember)
            .where(TeamMember.team_id == team.id)
        )
        notifications = await db.scalar(
            select(func.count())
            .select_from(DomainOutbox)
            .where(DomainOutbox.aggregate_id == team.id)
        )
    assert invite is not None and invite.used is True
    assert members == 1
    assert notifications == 1


@pytest.mark.asyncio
async def test_existing_membership_is_idempotent_but_still_consumes_invite(invite_store):
    _engine, session_factory = invite_store
    _owner, first, _second, team = await _seed(session_factory, token="existing")
    async with session_factory() as db:
        db.add(TeamMember(team_id=team.id, user_id=first.id, role="member"))
        await db.commit()

    async with session_factory() as db:
        result = await team_svc.join_by_token(db, first.id, "existing")

    assert result == {"ok": True, "team_id": team.id}
    async with session_factory() as db:
        count = await db.scalar(
            select(func.count())
            .select_from(TeamMember)
            .where(TeamMember.team_id == team.id, TeamMember.user_id == first.id)
        )
        notifications = await db.scalar(
            select(func.count())
            .select_from(DomainOutbox)
            .where(DomainOutbox.aggregate_id == team.id)
        )
    assert count == 1
    assert notifications == 0


@pytest.mark.asyncio
async def test_expired_or_reused_invite_cannot_add_members(invite_store):
    _engine, session_factory = invite_store
    _owner, first, second, team = await _seed(
        session_factory,
        token="expired",
        expired=True,
    )

    async with session_factory() as db:
        expired = await team_svc.join_by_token(db, first.id, "expired")
    assert expired["ok"] is False

    async with session_factory() as db:
        invite = await db.scalar(select(TeamInvite).where(TeamInvite.token == "expired"))
        invite.expires_at = utc_now() + timedelta(hours=1)
        await db.commit()
    async with session_factory() as db:
        first_result = await team_svc.join_by_token(db, first.id, "expired")
    async with session_factory() as db:
        reused = await team_svc.join_by_token(db, second.id, "expired")

    assert first_result["ok"] is True
    assert reused["ok"] is False
    async with session_factory() as db:
        members = await db.scalar(
            select(func.count())
            .select_from(TeamMember)
            .where(TeamMember.team_id == team.id)
        )
    assert members == 1


@pytest.mark.asyncio
async def test_invite_phone_validates_role_and_rolls_back_effect_failure(
    invite_store,
    monkeypatch,
):
    _engine, session_factory = invite_store
    _owner, first, _second, team = await _seed(session_factory, token="phone")

    async with session_factory() as db:
        invalid = await team_svc.invite_phone(db, team.id, first.phone, "owner")
    assert invalid == {"ok": False, "message": "Некорректная роль"}

    async def broken_enqueue(*_args, **_kwargs):
        raise RuntimeError("delivery_prepare_unavailable")

    monkeypatch.setattr(team_svc, "_enqueue_notification", broken_enqueue)
    async with session_factory() as db:
        with pytest.raises(RuntimeError, match="delivery_prepare_unavailable"):
            await team_svc.invite_phone(db, team.id, first.phone, "viewer")

    async with session_factory() as db:
        membership = await db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == team.id,
                TeamMember.user_id == first.id,
            )
        )
        outbox_count = await db.scalar(select(func.count()).select_from(DomainOutbox))
    assert membership is None
    assert outbox_count == 0


def test_join_source_uses_atomic_conditional_update_and_durable_notification():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "services" / "team_service.py").read_text(
        encoding="utf-8"
    )
    join_start = source.index("async def join_by_token")
    join_end = source.index("async def set_member_role", join_start)
    join_block = source[join_start:join_end]
    invite_start = source.index("async def invite_phone")
    invite_end = source.index("async def team_owner_ids", invite_start)
    invite_block = source[invite_start:invite_end]

    assert "update(TeamInvite)" in join_block
    assert "TeamInvite.used.is_(False)" in join_block
    assert ".returning(TeamInvite.team_id, TeamInvite.role)" in join_block
    assert "select(TeamInvite)" not in join_block
    assert "_enqueue_notification" in join_block
    assert "_enqueue_notification" in invite_block
    assert "notification_service.notify" not in invite_block


def test_team_routes_have_no_demo_deadlock_copy():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "api" / "v1" / "teams.py").read_text(encoding="utf-8")
    assert "тупик на демо" not in source.lower()
