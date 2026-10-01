"""COM-024 pagination/aggregates, COM-037 search, COM-004 attachment errors, COM-003 media ACL."""
import base64
from datetime import datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadRead,
    Project,
    User,
    UserRole,
)
from app.services import chat_service as chat_svc

BASE = datetime(2026, 1, 1, 10, 0, 0)
PNG_1PX = base64.b64encode(
    base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
).decode()


async def _seed(db, *, n=0, thread_id="th-pg"):
    contractor = User(id="ct-pg", phone="+79990008001", role=UserRole.contractor, full_name="Иван Прораб")
    customer = User(id="cu-pg", phone="+79990008002", role=UserRole.customer)
    project = Project(
        id="p-pg", name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id, budget_planned=1, budget_spent=0,
    )
    thread = ChatThread(id=thread_id, project_id=project.id, title="T", created_by=contractor.id)
    db.add_all([contractor, customer, project, thread])
    db.add_all([
        ChatMessage(
            id=f"m{i:03d}", thread_id=thread_id, user_id=contractor.id, author_role="contractor",
            text=f"msg {i}", created_at=BASE + timedelta(minutes=i),
        )
        for i in range(n)
    ])
    await db.commit()
    db.expunge_all()
    return contractor, customer, project, thread


class _Client:
    def __init__(self, db, user):
        self.db, self.user = db, user

    async def __aenter__(self):
        async def _db():
            yield self.db

        async def _user():
            return self.user

        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = _user
        self.c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        return await self.c.__aenter__()

    async def __aexit__(self, *exc):
        await self.c.__aexit__(*exc)
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_chat_paginates_latest_window_and_cursor(db):
    contractor, _cu, project, thread = await _seed(db, n=120)
    async with _Client(db, contractor) as c:
        r = await c.get(f"/api/v1/projects/{project.id}/chats/{thread.id}")
        assert r.status_code == 200, r.text
        body = r.json()
        ids = [m["id"] for m in body["messages"]]
        assert len(ids) == 50 and ids[0] == "m070" and ids[-1] == "m119"
        assert body["has_more_before"] is True and body["has_more_after"] is False
        assert body["messages"][0]["author_name"] == "Иван Прораб"
        assert body["messages"][0]["author_id"] == contractor.id
        assert "phone" not in str(body["messages"][0])

        r2 = await c.get(f"/api/v1/projects/{project.id}/chats/{thread.id}", params={"before": ids[0], "limit": 50})
        ids2 = [m["id"] for m in r2.json()["messages"]]
        assert ids2[0] == "m020" and ids2[-1] == "m069"
        assert r2.json()["has_more_before"] is True

        r3 = await c.get(f"/api/v1/projects/{project.id}/chats/{thread.id}", params={"before": "m020", "limit": 50})
        assert [m["id"] for m in r3.json()["messages"]][0] == "m000"
        assert r3.json()["has_more_before"] is False

        bad = await c.get(f"/api/v1/projects/{project.id}/chats/{thread.id}", params={"before": "nope"})
        assert bad.status_code == 404


@pytest.mark.asyncio
async def test_get_chat_around_and_pinned_independent_of_page(db):
    contractor, _cu, project, thread = await _seed(db, n=120)
    pinned = await db.get(ChatMessage, "m003")
    pinned.is_pinned = True
    await db.commit()
    async with _Client(db, contractor) as c:
        r = await c.get(f"/api/v1/projects/{project.id}/chats/{thread.id}")
        body = r.json()
        assert "m003" not in [m["id"] for m in body["messages"]]
        assert [m["id"] for m in body["pinned_messages"]] == ["m003"]

        r = await c.get(f"/api/v1/projects/{project.id}/chats/{thread.id}", params={"around": "m060", "limit": 20})
        body = r.json()
        ids = [m["id"] for m in body["messages"]]
        assert "m060" in ids and ids == sorted(ids)
        assert body["has_more_before"] is True and body["has_more_after"] is True
        assert 15 <= len(ids) <= 22


@pytest.mark.asyncio
async def test_list_threads_enriched_aggregates_match_per_thread_counts(db):
    contractor, customer, project, thread = await _seed(db, n=5)
    t2 = ChatThread(id="th-pg2", project_id=project.id, title="T2", created_by=customer.id)
    db.add(t2)
    db.add_all([
        ChatMessage(id="x1", thread_id=t2.id, user_id=customer.id, author_role="customer", text="a", created_at=BASE),
        ChatMessage(id="x2", thread_id=t2.id, user_id=customer.id, author_role="customer", text="b", created_at=BASE + timedelta(minutes=1)),
        ChatMessage(id="x3", thread_id=t2.id, user_id=customer.id, author_role="system", message_type=ChatMessageType.system, text="s", created_at=BASE + timedelta(minutes=2)),
        ChatThreadRead(thread_id=thread.id, user_id=customer.id, last_read_at=BASE + timedelta(minutes=2)),
    ])
    await db.commit()
    out = {t["id"]: t for t in await chat_svc.list_threads_enriched(db, project.id, customer.id)}
    assert out["th-pg"]["unread_count"] == await chat_svc.count_unread_in_thread(db, "th-pg", customer.id) == 2
    assert out["th-pg2"]["unread_count"] == 0  # own messages and system are not unread
    assert out["th-pg"]["last_message"]["id"] == "m004"
    assert out["th-pg2"]["last_message"]["id"] == "x3"
    assert out["th-pg"]["last_message"]["author_id"] == contractor.id
    assert await chat_svc.count_unread_project(db, project.id, customer.id) == 2


@pytest.mark.asyncio
async def test_search_returns_id_escapes_wildcards_orders_and_filters(db):
    contractor, customer, project, thread = await _seed(db, n=0)
    t_arch = ChatThread(id="th-arch", project_id=project.id, title="Arch", created_by=customer.id)
    db.add(t_arch)
    rows = [
        ChatMessage(id="s1", thread_id=thread.id, user_id=contractor.id, author_role="contractor", text="скидка 50% на плитку", created_at=BASE),
        ChatMessage(id="s2", thread_id=thread.id, user_id=contractor.id, author_role="contractor", text="скидка 5000 рублей", created_at=BASE + timedelta(minutes=1)),
        ChatMessage(id="s3", thread_id=thread.id, user_id=contractor.id, author_role="contractor", text="файл_1 готов", created_at=BASE + timedelta(minutes=2)),
        ChatMessage(id="s4", thread_id=thread.id, user_id=contractor.id, author_role="contractor", text="файлы 1 готовы", created_at=BASE + timedelta(minutes=3)),
        ChatMessage(id="s5", thread_id=thread.id, user_id=contractor.id, author_role="system", message_type=ChatMessageType.system, text="скидка системная", created_at=BASE + timedelta(minutes=4)),
        ChatMessage(id="s6", thread_id=t_arch.id, user_id=contractor.id, author_role="contractor", text="скидка в архиве", created_at=BASE + timedelta(minutes=5)),
        ChatMessage(id="s7", thread_id=thread.id, user_id=contractor.id, author_role="contractor", text="скидка удалена", meta_json='{"deleted_at": "2026-01-01T00:00:00"}', created_at=BASE + timedelta(minutes=6)),
        ChatThreadRead(thread_id=t_arch.id, user_id=contractor.id, last_read_at=BASE, is_archived=True),
    ]
    db.add_all(rows)
    await db.commit()
    async with _Client(db, contractor) as c:
        base = f"/api/v1/projects/{project.id}/chats/search"
        r = await c.get(base, params={"q": "скидка"})
        assert r.status_code == 200, r.text
        assert [h["id"] for h in r.json()] == ["s2", "s1"]  # newest first, no system/archived/deleted
        assert r.json()[0]["thread_id"] == thread.id and r.json()[0]["created_at"]

        pct = await c.get(base, params={"q": "50%"})
        assert [h["id"] for h in pct.json()] == ["s1"]
        wild = await c.get(base, params={"q": "%"})
        assert [h["id"] for h in wild.json()] == ["s1"]  # literal %, not "match everything"
        under = await c.get(base, params={"q": "файл_1"})
        assert [h["id"] for h in under.json()] == ["s3"]  # `_` is not a one-char wildcard
        assert (await c.get(base, params={"q": "   "})).json() == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload,status,code",
    [
        ("data:application/pdf;base64," + base64.b64encode(b"%PDF-1.4 x").decode(), 415, "unsupported_image_type"),
        ("data:video/mp4;base64," + base64.b64encode(b"\x00\x00\x00\x18ftyp").decode(), 415, "unsupported_image_type"),
        ("data:image/png;base64,@@@not-base64@@@", 422, "invalid_image_base64"),
    ],
)
async def test_unsupported_attachment_is_client_error_not_500(db, payload, status, code):
    contractor, _cu, project, thread = await _seed(db)
    async with _Client(db, contractor) as c:
        r = await c.post(
            f"/api/v1/projects/{project.id}/chats/{thread.id}/messages",
            json={"client_request_id": "req-attach-0001", "message_type": "file", "text": "doc", "image_data": payload},
        )
    assert r.status_code == status, r.text
    assert r.json()["detail"]["code"] == code
    assert r.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_oversized_attachment_is_413(db, monkeypatch):
    from app.services import storage_service

    monkeypatch.setattr(storage_service, "MAX_IMAGE_BYTES", 10)
    contractor, _cu, project, thread = await _seed(db)
    async with _Client(db, contractor) as c:
        r = await c.post(
            f"/api/v1/projects/{project.id}/chats/{thread.id}/messages",
            json={"client_request_id": "req-attach-0002", "message_type": "photo", "text": "x",
                  "image_data": "data:image/png;base64," + PNG_1PX},
        )
    assert r.status_code == 413, r.text
    assert r.json()["detail"]["code"] == "image_too_large"


@pytest.mark.asyncio
async def test_png_attachment_works_and_media_acl_still_requires_auth(db):
    contractor, _cu, project, thread = await _seed(db)
    async with _Client(db, contractor) as c:
        r = await c.post(
            f"/api/v1/projects/{project.id}/chats/{thread.id}/messages",
            json={"client_request_id": "req-attach-0003", "message_type": "photo", "text": "Фото",
                  "image_data": "data:image/png;base64," + PNG_1PX},
        )
        assert r.status_code == 200, r.text
        url = r.json()["image_url"]
        assert "/api/v1/media/chat-media/" in url
    path = url[url.index("/api/v1/media/"):]
    app.dependency_overrides.clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.get(path)).status_code == 401  # ACL not weakened
