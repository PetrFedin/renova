"""COM-009/022/023/038: in-app notification read side (count, mark-all, pagination, ACL, digest)."""
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.main import app
from app.models.entities import AppNotification, NotificationType, User, UserRole
from app.services import notification_service as svc


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _users(db):
    a = User(id="cu-nt", phone="+79990007001", role=UserRole.customer)
    b = User(id="ct-nt", phone="+79990007002", role=UserRole.contractor)
    db.add_all([a, b])
    await db.commit()
    return a, b


def _n(uid, i, **kw):
    return AppNotification(
        user_id=uid,
        notification_type=kw.pop("t", NotificationType.other),
        title=kw.pop("title", f"n{i}"),
        body="b",
        created_at=utc_now() - timedelta(minutes=i),
        **kw,
    )


@pytest.mark.asyncio
async def test_unread_count_and_mark_all_not_capped_at_50(db):
    cu, ct = await _users(db)
    db.add_all([_n(cu.id, i) for i in range(60)] + [_n(ct.id, i) for i in range(3)])
    await db.commit()
    client = await _client(db, cu)
    try:
        assert (await client.get("/api/v1/notifications/unread-count")).json() == {"count": 60}
        r = await client.post("/api/v1/notifications/mark-all-read")
        assert r.json() == {"ok": True, "count": 60}
        assert (await client.get("/api/v1/notifications/unread-count")).json() == {"count": 0}
    finally:
        app.dependency_overrides.clear()
    other = await db.scalar(
        select(func.count()).select_from(AppNotification).where(
            AppNotification.user_id == ct.id, AppNotification.read.is_(False)
        )
    )
    assert other == 3  # another user's notifications are untouched


@pytest.mark.asyncio
async def test_list_is_paginated_newest_first(db):
    cu, _ = await _users(db)
    db.add_all([_n(cu.id, i) for i in range(5)])
    await db.commit()
    client = await _client(db, cu)
    try:
        page1 = (await client.get("/api/v1/notifications?limit=2&offset=0")).json()
        page2 = (await client.get("/api/v1/notifications?limit=2&offset=2")).json()
        page3 = (await client.get("/api/v1/notifications?limit=2&offset=4")).json()
        assert (await client.get("/api/v1/notifications?limit=0")).status_code == 422
    finally:
        app.dependency_overrides.clear()
    assert [n["title"] for n in page1 + page2 + page3] == ["n0", "n1", "n2", "n3", "n4"]
    assert len(page3) == 1


@pytest.mark.asyncio
async def test_snoozed_hidden_from_count(db):
    cu, _ = await _users(db)
    db.add_all([_n(cu.id, 0), _n(cu.id, 1, snoozed_until=utc_now() + timedelta(hours=2))])
    await db.commit()
    assert await svc.count_unread(db, cu.id) == 1


@pytest.mark.asyncio
async def test_waste_reminders_check_is_admin_only(db):
    cu, ct = await _users(db)
    client = await _client(db, cu)
    try:
        assert (await client.post("/api/v1/notifications/waste-reminders/check")).status_code == 403
    finally:
        app.dependency_overrides.clear()
    client = await _client(db, ct)  # local contractor fallback = admin in tests
    try:
        r = await client.post("/api/v1/notifications/waste-reminders/check")
        assert r.status_code == 200 and "sent" in r.json()
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_reaction_digest_push_is_idempotent_and_not_self_counted(db):
    cu, _ = await _users(db)
    db.add(_n(cu.id, 1, t=NotificationType.reaction, title="r"))
    await db.commit()
    client = await _client(db, cu)
    try:
        first = (await client.get("/api/v1/notifications/reaction-digest?push=1")).json()
        second = (await client.get("/api/v1/notifications/reaction-digest?push=1")).json()
    finally:
        app.dependency_overrides.clear()
    assert first["digest_push"] is True and second["digest_push"] is False
    assert first["count"] == second["count"] == 1  # digest is not a reaction
    digests = await db.scalar(
        select(func.count()).select_from(AppNotification).where(
            AppNotification.user_id == cu.id, AppNotification.title.like("Сводка реакций%")
        )
    )
    assert digests == 1


def test_notif_dict_return_to_is_decoded():
    n = AppNotification(
        id="x", notification_type=NotificationType.other, title="t", body="b", read=False,
        created_at=utc_now(),
        link_path=svc._stored_link("/stage/s1", "/(customer)/(tabs)/repair?tab=control&f=1"),
    )
    assert svc.notif_dict(n)["return_to"] == "/(customer)/(tabs)/repair?tab=control&f=1"
    n.link_path = "/documents"
    assert svc.notif_dict(n)["return_to"] is None
