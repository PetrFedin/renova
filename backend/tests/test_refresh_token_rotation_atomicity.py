from __future__ import annotations

import asyncio
from datetime import timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import User, UserRole, UserSession
from app.services import session_service as session_svc


@pytest_asyncio.fixture
async def session_store(tmp_path):
    db_path = tmp_path / "refresh-rotation.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"timeout": 30},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        db.add(User(id="refresh-user", phone="+79990001201", role=UserRole.customer))
        await db.commit()
    yield engine, session_factory
    await engine.dispose()


async def _create_initial(session_factory):
    async with session_factory() as db:
        return await session_svc.create_session(
            db,
            "refresh-user",
            device_id="ios-device",
            ip="127.0.0.1",
            user_agent="Renova iOS",
        )


@pytest.mark.asyncio
async def test_parallel_rotation_has_exactly_one_replacement(session_store):
    _engine, session_factory = session_store
    original, raw = await _create_initial(session_factory)

    async def rotate():
        async with session_factory() as db:
            return await session_svc.rotate_session(db, raw)

    results = await asyncio.gather(rotate(), rotate())

    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    replacement, replacement_raw = winners[0]
    assert replacement.id != original.id
    assert replacement_raw != raw
    assert replacement.device_id == "ios-device"
    assert replacement.ip == "127.0.0.1"
    assert replacement.user_agent == "Renova iOS"

    async with session_factory() as db:
        sessions = (
            await db.execute(
                select(UserSession)
                .where(UserSession.user_id == "refresh-user")
                .order_by(UserSession.created_at.asc(), UserSession.id.asc())
            )
        ).scalars().all()
    assert len(sessions) == 2
    assert sum(1 for item in sessions if item.revoked_at is None) == 1
    assert next(item for item in sessions if item.id == original.id).revoked_at is not None


@pytest.mark.asyncio
async def test_expired_refresh_is_revoked_without_replacement(session_store):
    _engine, session_factory = session_store
    original, raw = await _create_initial(session_factory)
    async with session_factory() as db:
        stored = await db.get(UserSession, original.id)
        stored.expires_at = utc_now() - timedelta(seconds=1)
        await db.commit()

    async with session_factory() as db:
        result = await session_svc.rotate_session(db, raw)

    assert result is None
    async with session_factory() as db:
        stored = await db.get(UserSession, original.id)
        count = await db.scalar(select(func.count()).select_from(UserSession))
    assert stored.revoked_at is not None
    assert count == 1


@pytest.mark.asyncio
async def test_replacement_failure_rolls_back_original_claim(
    session_store,
    monkeypatch,
):
    _engine, session_factory = session_store
    original, raw = await _create_initial(session_factory)
    monkeypatch.setattr(session_svc, "mint_refresh_token", lambda: raw)

    async with session_factory() as db:
        with pytest.raises(IntegrityError):
            await session_svc.rotate_session(db, raw)

    async with session_factory() as db:
        stored = await db.get(UserSession, original.id)
        count = await db.scalar(select(func.count()).select_from(UserSession))
    assert stored.revoked_at is None
    assert count == 1


@pytest.mark.asyncio
async def test_revoke_operations_are_atomic_and_idempotent(session_store):
    _engine, session_factory = session_store
    _first, first_raw = await _create_initial(session_factory)
    async with session_factory() as db:
        second, _second_raw = await session_svc.create_session(db, "refresh-user")

    async with session_factory() as db:
        assert await session_svc.revoke_session(db, first_raw) is True
    async with session_factory() as db:
        assert await session_svc.revoke_session(db, first_raw) is False
    async with session_factory() as db:
        assert await session_svc.revoke_all_user_sessions(db, "refresh-user") == 1
    async with session_factory() as db:
        assert await session_svc.revoke_all_user_sessions(db, "refresh-user") == 0
        active = await db.scalar(
            select(func.count())
            .select_from(UserSession)
            .where(UserSession.revoked_at.is_(None))
        )
    assert active == 0
    assert second.id is not None


def test_rotation_source_uses_one_conditional_claim_and_one_transaction():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "services" / "session_service.py").read_text(
        encoding="utf-8"
    )
    start = source.index("async def rotate_session")
    end = source.index("async def revoke_session", start)
    block = source[start:end]

    assert "update(UserSession)" in block
    assert "UserSession.revoked_at.is_(None)" in block
    assert ".returning(" in block
    assert "select(UserSession)" not in block
    assert "await db.flush()" in block
    assert block.count("await db.commit()") == 2
    assert "await db.rollback()" in block
