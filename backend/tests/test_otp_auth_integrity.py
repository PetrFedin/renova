from __future__ import annotations

import inspect

import pytest
import pytest_asyncio
from fastapi.routing import iter_route_contexts
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.main import app
from app.models.entities import AuditLog, User, UserRole, UserSession
from app.services import otp_abuse_service, otp_login_service, session_service


@pytest.fixture(autouse=True)
def reset_abuse_state(monkeypatch):
    otp_abuse_service.reset_local_state()
    monkeypatch.setattr("app.services.otp_service._redis_client", lambda: None)
    yield
    otp_abuse_service.reset_local_state()


@pytest_asyncio.fixture
async def auth_store(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'otp-auth.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


def test_send_abuse_guard_limits_phone_ip_and_device_independently():
    phone = "+79991234567"
    for _ in range(otp_abuse_service._SEND_LIMITS["phone"]):
        assert otp_abuse_service.check_and_record(
            "send", phone=phone, ip="203.0.113.5", device_id="device-a"
        ).allowed
    blocked = otp_abuse_service.check_and_record(
        "send", phone=phone, ip="203.0.113.99", device_id="device-b"
    )
    assert blocked.allowed is False
    assert blocked.dimension == "phone"
    assert blocked.retry_after > 0

    otp_abuse_service.reset_local_state()
    for index in range(otp_abuse_service._SEND_LIMITS["ip"]):
        decision = otp_abuse_service.check_and_record(
            "send",
            phone=f"+7999000{index:04d}",
            ip="203.0.113.10",
            device_id=f"device-{index}",
        )
        assert decision.allowed
    blocked = otp_abuse_service.check_and_record(
        "send", phone="+79998887766", ip="203.0.113.10", device_id="fresh-device"
    )
    assert blocked.allowed is False
    assert blocked.dimension == "ip"


@pytest.mark.asyncio
async def test_atomic_login_persists_user_profile_session_and_audit_together(auth_store):
    async with auth_store() as db:
        result = await otp_login_service.complete_otp_login(
            db,
            phone="+79991234567",
            role="customer",
            full_name="Customer",
            inn=None,
            device_id="ios-device",
            ip="203.0.113.5",
            user_agent="Renova iOS",
        )
        user_id = result.user.id
        assert result.created is True
        assert result.refresh_token
        assert result.access_token

    async with auth_store() as db:
        user = await db.get(User, user_id)
        sessions = await db.scalar(
            select(func.count()).select_from(UserSession).where(UserSession.user_id == user_id)
        )
        audits = await db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.user_id == user_id)
        )
    assert user is not None
    assert user.profile_code
    assert sessions == 1
    assert audits == 1


@pytest.mark.asyncio
async def test_login_effect_failure_rolls_back_new_user_session_and_audit(auth_store, monkeypatch):
    original = session_service.create_session

    async def fail_after_session(*args, **kwargs):
        await original(*args, **kwargs)
        raise RuntimeError("synthetic_session_effect_failure")

    monkeypatch.setattr(session_service, "create_session", fail_after_session)
    async with auth_store() as db:
        with pytest.raises(RuntimeError, match="synthetic_session_effect_failure"):
            await otp_login_service.complete_otp_login(
                db,
                phone="+79991230000",
                role="contractor",
                full_name="Contractor",
                inn=None,
                device_id="device-fail",
                ip="203.0.113.6",
                user_agent="test",
            )

    async with auth_store() as db:
        users = await db.scalar(select(func.count()).select_from(User))
        sessions = await db.scalar(select(func.count()).select_from(UserSession))
        audits = await db.scalar(select(func.count()).select_from(AuditLog))
    assert users == 0
    assert sessions == 0
    assert audits == 0


def test_runtime_has_one_canonical_sms_send_and_verify_handler():
    for path in ("/api/v1/auth/sms/send", "/api/v1/auth/sms/verify"):
        matches = [
            route
            for route in iter_route_contexts(app.routes)
            if route.path == path
            and "POST" in (route.methods or set())
        ]
        assert len(matches) == 1, (path, matches)


def test_source_contract_keeps_login_in_one_transaction():
    source = inspect.getsource(otp_login_service.complete_otp_login)
    assert "commit=False" in source
    assert source.count("await db.commit()") == 1
    assert "await db.rollback()" in source
    assert "AuditLog(" in source
