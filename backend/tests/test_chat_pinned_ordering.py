"""Pinned chat semantics.

- Thread lists/inbox: pinned threads first (latest pinned first), then the
  rest by newest activity.
- Message history: pinned messages stay in chronological order; the pinned
  subset is an additional ``pinned_messages`` selection, not a removal.
"""
from datetime import datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import ChatMessage, ChatThread, Project, User, UserRole
from app.services import chat_service as chat_svc


def _t(id_, updated, pinned=False, pinned_at=None):
    return {"id": id_, "updated_at": updated, "is_pinned": pinned, "pinned_at": pinned_at}


def test_thread_order_pinned_first_then_newest():
    items = [
        _t("old", "2026-01-01T10:00:00"),
        _t("new", "2026-03-01T10:00:00"),
        _t("pin-old", "2026-01-02T10:00:00", True, "2026-02-01T10:00:00"),
        _t("pin-recent", "2026-01-03T10:00:00", True, "2026-02-05T10:00:00"),
    ]
    items.sort(key=chat_svc._thread_order_key)
    assert [x["id"] for x in items] == ["pin-recent", "pin-old", "new", "old"]


@pytest.mark.asyncio
async def test_get_chat_keeps_pinned_message_in_chronology(db):
    user = User(id="ct-pin", phone="+79990007001", role=UserRole.contractor)
    project = Project(
        id="p-pin", name="P", renovation_type="cosmetic",
        customer_id="cu-pin", contractor_id=user.id, budget_planned=1, budget_spent=0,
    )
    customer = User(id="cu-pin", phone="+79990007002", role=UserRole.customer)
    thread = ChatThread(id="th-pin", project_id=project.id, title="T", created_by=user.id)
    base = datetime(2026, 1, 1, 10, 0, 0)
    msgs = [
        ChatMessage(id=f"m{i}", thread_id=thread.id, user_id=user.id, author_role="contractor",
                    text=f"msg {i}", is_pinned=(i == 1), created_at=base + timedelta(minutes=i))
        for i in range(3)
    ]
    db.add_all([user, customer, project, thread, *msgs])
    await db.commit()
    db.expunge_all()

    async def _db():
        yield db

    async def _user():
        return user

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get(f"/api/v1/projects/{project.id}/chats/{thread.id}")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["id"] for m in body["messages"]] == ["m0", "m1", "m2"]
    assert [m["id"] for m in body["pinned_messages"]] == ["m1"]
