"""COM-006/010/011/012/013/014/015/016/034/042: chat spoofing, ACL and lifecycle.

For every item: a forbidden actor gets 403/422 and the data is unchanged, an
allowed actor gets 200. Route tests use the real app with dependency overrides
(same pattern as test_floor_plan_acl_and_replay.py); WS tests drive ``chat_ws``
with a fake socket so no server is needed.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.api.v1 import ws as ws_mod
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadParticipant,
    DomainOutbox,
    Project,
    ProjectViewer,
    Team,
    TeamMember,
    User,
    UserRole,
    WorkOrder,
)
from app.services import chat_service as chat_svc


async def _seed(db):
    customer = User(id="hc-cu", phone="+79990007001", role=UserRole.customer, full_name="Customer")
    contractor = User(id="hc-ct", phone="+79990007002", role=UserRole.contractor, full_name="Contractor")
    guest = User(id="hc-gu", phone="+79990007003", role=UserRole.customer, full_name="Guest")
    viewer = User(id="hc-vw", phone="+79990007004", role=UserRole.contractor, full_name="Viewer")
    outsider = User(id="hc-out", phone="+79990007005", role=UserRole.contractor, full_name="Outsider")
    invited = User(id="hc-inv", phone="+79990007006", role=UserRole.contractor, full_name="Invited", profile_code="HC0001")
    project = Project(
        id="hc-pr", name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id, budget_planned=1, budget_spent=0,
    )
    team = Team(id="hc-team", name="T", owner_id=contractor.id)
    thread = ChatThread(id="hc-th", project_id=project.id, title="Общий", created_by=contractor.id)
    db.add_all([customer, contractor, guest, viewer, outsider, invited, project, team, thread])
    await db.flush()
    db.add_all([
        ProjectViewer(project_id=project.id, user_id=guest.id),
        TeamMember(team_id=team.id, user_id=viewer.id, role="viewer"),
        ChatThreadParticipant(
            id="hc-part", thread_id=thread.id, user_id=invited.id, invited_by=customer.id, status="active",
        ),
    ])
    msg = ChatMessage(
        id="hc-m1", thread_id=thread.id, user_id=contractor.id, author_role="contractor",
        message_type=ChatMessageType.text, text="Готово",
    )
    db.add(msg)
    await db.commit()
    return dict(customer=customer, contractor=contractor, guest=guest, viewer=viewer,
                outsider=outsider, invited=invited, project=project, thread=thread)


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


BASE = "/api/v1/projects/hc-pr/chats/hc-th"


async def _count(db, model):
    return await db.scalar(select(func.count()).select_from(model))


# --- COM-012 -------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("mtype", ["system", "payment", "task", "invoice", "bogus"])
async def test_client_cannot_spoof_service_message_types(db, mtype):
    s = await _seed(db)
    before = await _count(db, ChatMessage)
    async with await _client(db, s["customer"]) as c:
        r = await c.post(f"{BASE}/messages", json={"client_request_id": "spoof-0001", "text": "x", "message_type": mtype})
    assert r.status_code == 422
    assert await _count(db, ChatMessage) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("mtype", ["text", "confirm", "file", "photo"])
async def test_client_user_message_types_allowed(db, mtype):
    s = await _seed(db)
    async with await _client(db, s["customer"]) as c:
        r = await c.post(f"{BASE}/messages", json={"client_request_id": f"ok-{mtype}-0001", "text": "x", "message_type": mtype})
    assert r.status_code == 200
    assert r.json()["message_type"] == mtype


# --- COM-014 -------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("who,code", [("guest", 403), ("viewer", 403), ("outsider", 403),
                                      ("customer", 200), ("contractor", 200), ("invited", 200)])
async def test_react_requires_write_access(db, who, code):
    s = await _seed(db)
    msg = await db.get(ChatMessage, "hc-m1")
    before = msg.meta_json
    async with await _client(db, s[who]) as c:
        r = await c.post(f"{BASE}/messages/hc-m1/react", json={"emoji": "👍"})
    assert r.status_code == code
    await db.refresh(msg)
    if code == 403:
        assert msg.meta_json == before
    else:
        assert r.json()["reactions"] == {"👍": [s[who].id]}


# --- COM-015 / COM-016 / COM-034 ------------------------------------------

@pytest.mark.asyncio
async def test_task_invalid_due_date_is_422_not_500(db):
    s = await _seed(db)
    before = (await _count(db, WorkOrder), await _count(db, ChatMessage))
    async with await _client(db, s["customer"]) as c:
        r = await c.post(f"{BASE}/messages/hc-m1/task", json={"title": "T", "due_at": "завтра"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_due_at"
    assert (await _count(db, WorkOrder), await _count(db, ChatMessage)) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("assignee", ["not-a-user-at-all", "hc-out", "hc-gu", "hc-vw"])
async def test_task_assignee_must_belong_to_project(db, assignee):
    s = await _seed(db)
    before = (await _count(db, WorkOrder), await _count(db, ChatMessage))
    async with await _client(db, s["customer"]) as c:
        r = await c.post(f"{BASE}/messages/hc-m1/task", json={"title": "T", "assignee_id": assignee})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "assignee_not_in_project"
    assert (await _count(db, WorkOrder), await _count(db, ChatMessage)) == before


@pytest.mark.asyncio
async def test_task_valid_assignee_goes_through_outbox_and_is_replay_safe(db):
    s = await _seed(db)
    body = {"title": "Грунтовка", "assignee_id": "hc-ct", "due_at": "2030-01-15", "client_request_id": "task-req-0001"}
    async with await _client(db, s["customer"]) as c:
        r1 = await c.post(f"{BASE}/messages/hc-m1/task", json=body)
        r2 = await c.post(f"{BASE}/messages/hc-m1/task", json=body)
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r1.json()["message_type"] == "task"
    tasks = (await db.execute(select(ChatMessage).where(ChatMessage.message_type == ChatMessageType.task))).scalars().all()
    assert len(tasks) == 1
    # COM-034: durable outbox notification for the other side, not a sync notify.
    rows = (await db.execute(select(DomainOutbox).where(DomainOutbox.aggregate_id == tasks[0].id))).scalars().all()
    assert any(json.loads(r.payload_json).get("user_id") == "hc-ct" for r in rows)


@pytest.mark.asyncio
async def test_invoice_message_is_idempotent_and_unarchives_recipient(db):
    s = await _seed(db)
    await chat_svc.set_thread_state(db, "hc-th", "hc-cu", is_archived=True)
    body = {"title": "Аванс", "amount": 1000, "client_request_id": "inv-req-0001"}
    async with await _client(db, s["contractor"]) as c:
        r1 = await c.post(f"{BASE}/invoice", json=body)
        r2 = await c.post(f"{BASE}/invoice", json=body)
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    state = await chat_svc.get_thread_read_state(db, "hc-th", "hc-cu")
    assert state.is_archived is False  # _restore_recipient_visibility


# --- COM-006: edit / delete -------------------------------------------------

@pytest.mark.asyncio
async def test_author_edits_and_soft_deletes_own_message_others_forbidden(db):
    s = await _seed(db)
    async with await _client(db, s["customer"]) as c:
        r = await c.patch(f"{BASE}/messages/hc-m1", json={"text": "hack"})
        assert r.status_code == 403
        r = await c.delete(f"{BASE}/messages/hc-m1")
        assert r.status_code == 403
    msg = await db.get(ChatMessage, "hc-m1")
    assert msg.text == "Готово"

    async with await _client(db, s["contractor"]) as c:
        r = await c.patch(f"{BASE}/messages/hc-m1", json={"text": "Готово v2"})
        assert r.status_code == 200 and r.json()["text"] == "Готово v2" and r.json()["edited_at"]
        r = await c.patch(f"{BASE}/messages/hc-m1", json={"text": "Готово v2"})
        assert r.status_code == 200  # identical edit: no-op
        r = await c.delete(f"{BASE}/messages/hc-m1")
        assert r.status_code == 200 and r.json()["deleted"] is True and r.json()["text"] is None
        r = await c.delete(f"{BASE}/messages/hc-m1")
        assert r.status_code == 200 and r.json()["deleted"] is True  # idempotent
        r = await c.patch(f"{BASE}/messages/hc-m1", json={"text": "again"})
        assert r.status_code == 409
    await db.refresh(msg)
    assert msg.text is None and ChatMessage is not None
    assert await db.get(ChatMessage, "hc-m1") is not None  # soft: row kept


@pytest.mark.asyncio
async def test_edit_window_and_service_messages_protected(db):
    from datetime import timedelta
    from app.core.timeutil import utc_now

    s = await _seed(db)
    msg = await db.get(ChatMessage, "hc-m1")
    msg.created_at = utc_now() - timedelta(days=2)
    svc = ChatMessage(id="hc-svc", thread_id="hc-th", user_id="hc-ct", author_role="contractor",
                      message_type=ChatMessageType.payment, text="Счёт")
    db.add(svc)
    await db.commit()
    async with await _client(db, s["contractor"]) as c:
        assert (await c.patch(f"{BASE}/messages/hc-m1", json={"text": "late"})).status_code == 409
        assert (await c.patch(f"{BASE}/messages/hc-svc", json={"text": "x"})).status_code == 409
        assert (await c.delete(f"{BASE}/messages/hc-svc")).status_code == 409
        assert (await c.delete(f"{BASE}/messages/hc-m1")).status_code == 200  # delete has no window
    await db.refresh(svc)
    assert svc.text == "Счёт"


@pytest.mark.asyncio
async def test_guest_cannot_edit_or_delete(db):
    s = await _seed(db)
    async with await _client(db, s["guest"]) as c:
        assert (await c.patch(f"{BASE}/messages/hc-m1", json={"text": "x"})).status_code == 403
        assert (await c.delete(f"{BASE}/messages/hc-m1")).status_code == 403


# --- COM-006: thread rename / archive / participants -----------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("who,code", [("guest", 403), ("viewer", 403), ("invited", 403), ("outsider", 403),
                                      ("customer", 200), ("contractor", 200)])
async def test_rename_thread_only_creator_or_customer(db, who, code):
    s = await _seed(db)
    async with await _client(db, s[who]) as c:
        r = await c.patch(BASE, json={"title": "  Новый   заголовок "})
    assert r.status_code == code
    thread = await db.get(ChatThread, "hc-th")
    await db.refresh(thread)
    assert thread.title == ("Новый заголовок" if code == 200 else "Общий")


@pytest.mark.asyncio
async def test_archive_for_everyone_idempotent(db):
    s = await _seed(db)
    async with await _client(db, s["guest"]) as c:
        assert (await c.post(f"{BASE}/archive", json={})).status_code == 403
    async with await _client(db, s["customer"]) as c:
        assert (await c.post(f"{BASE}/archive", json={})).status_code == 200
        assert (await c.post(f"{BASE}/archive", json={})).status_code == 200
    for uid in ("hc-cu", "hc-ct", "hc-inv"):
        assert (await chat_svc.get_thread_read_state(db, "hc-th", uid)).is_archived is True
    async with await _client(db, s["contractor"]) as c:
        assert (await c.post(f"{BASE}/archive", json={"archived": False})).status_code == 200
    assert (await chat_svc.get_thread_read_state(db, "hc-th", "hc-cu")).is_archived is False


@pytest.mark.asyncio
async def test_remove_participant_by_customer_revokes_access(db):
    s = await _seed(db)
    async with await _client(db, s["invited"]) as c:
        assert (await c.delete(f"{BASE}/participants/hc-part")).status_code == 403
        assert (await c.get(f"{BASE}/participants")).status_code == 200
    async with await _client(db, s["customer"]) as c:
        assert (await c.delete(f"{BASE}/participants/hc-part")).status_code == 200
        assert (await c.delete(f"{BASE}/participants/hc-part")).status_code == 200  # idempotent
        assert (await c.delete(f"{BASE}/participants/nope")).status_code == 404
        listed = (await c.get(f"{BASE}/participants")).json()
        assert all(p["user_id"] != "hc-inv" for p in listed)
    async with await _client(db, s["invited"]) as c:
        assert (await c.get(f"{BASE}/participants")).status_code == 403
        assert (await c.post(f"{BASE}/messages", json={"client_request_id": "after-rm-0001", "text": "x"})).status_code == 403


@pytest.mark.asyncio
async def test_invited_participant_can_leave_project_members_cannot(db):
    s = await _seed(db)
    async with await _client(db, s["customer"]) as c:
        assert (await c.post(f"{BASE}/participants/leave")).status_code == 409
    async with await _client(db, s["outsider"]) as c:
        assert (await c.post(f"{BASE}/participants/leave")).status_code == 403
    async with await _client(db, s["invited"]) as c:
        assert (await c.post(f"{BASE}/participants/leave")).status_code == 200
        assert (await c.post(f"{BASE}/participants/leave")).status_code == 200  # idempotent
        assert (await c.get(f"{BASE}/participants")).status_code == 403


# --- COM-010 / COM-011 -----------------------------------------------------

async def _confirm_msg(db):
    m = ChatMessage(id="hc-conf", thread_id="hc-th", user_id="hc-ct", author_role="contractor",
                    message_type=ChatMessageType.confirm, text="Прошу подтвердить согласование")
    db.add(m)
    await db.commit()
    return m


@pytest.mark.asyncio
async def test_confirm_records_actor_notifies_author_and_refuses_self(db):
    s = await _seed(db)
    m = await _confirm_msg(db)
    async with await _client(db, s["contractor"]) as c:
        r = await c.post(f"{BASE}/messages/hc-conf/confirm")
    assert r.status_code == 403
    await db.refresh(m)
    assert not m.confirmed
    async with await _client(db, s["guest"]) as c:
        assert (await c.post(f"{BASE}/messages/hc-conf/confirm")).status_code == 403
    async with await _client(db, s["customer"]) as c:
        r = await c.post(f"{BASE}/messages/hc-conf/confirm")
        r2 = await c.post(f"{BASE}/messages/hc-conf/confirm")
    assert r.status_code == r2.status_code == 200
    body = r.json()
    assert body["confirmed"] is True and body["confirmed_by"] == "hc-cu" and body["confirmed_at"]
    rows = (await db.execute(select(DomainOutbox).where(DomainOutbox.aggregate_id == "hc-conf"))).scalars().all()
    notify = [x for x in rows if json.loads(x.payload_json).get("user_id") == "hc-ct"
              and json.loads(x.payload_json).get("notification_type") == "chat_message"]
    assert len(notify) == 1  # replay does not notify twice


@pytest.mark.asyncio
async def test_payment_message_marked_confirmed_only_on_real_payment(db):
    from app.services import payment_service as pay_svc

    s = await _seed(db)
    async with await _client(db, s["contractor"]) as c:
        inv = (await c.post(f"{BASE}/invoice", json={"title": "Аванс", "amount": 500, "client_request_id": "pay-req-0001"})).json()
    assert inv["confirmed"] is None
    async with await _client(db, s["customer"]) as c:
        r = await c.post(f"{BASE}/messages/{inv['id']}/confirm")
    assert r.status_code == 200 and r.json()["finance_action"] == "open_payment_sheet"
    msg = await db.get(ChatMessage, inv["id"])
    await db.refresh(msg)
    assert not msg.confirmed  # opening the sheet is not paying

    paid = await pay_svc.confirm_payment(db, inv["payment_id"], allow_without_settlement=True, machine_source="webhook")
    assert paid is not None
    await db.refresh(msg)
    assert msg.confirmed is True
    out = chat_svc.msg_dict(msg)
    assert out["confirmed_by"] == "payment" and out["confirmed_at"]
    async with await _client(db, s["customer"]) as c:
        r = await c.post(f"{BASE}/messages/{inv['id']}/confirm")
    assert r.json()["finance_action"] is None


# --- COM-013 / COM-042: WebSocket -------------------------------------------

class FakeWS:
    def __init__(self, frames, uid="u1"):
        self.frames = list(frames)
        self.sent: list[str] = []
        self.closed: int | None = None
        self.accepted = False
        self.query_params = {"token": uid}
        self.headers = {}

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000):
        self.closed = code

    async def send_text(self, data):
        self.sent.append(data)

    async def receive_text(self):
        if not self.frames:
            from fastapi import WebSocketDisconnect
            raise WebSocketDisconnect()
        item = self.frames.pop(0)
        if isinstance(item, float):
            await asyncio.sleep(item)
            return await self.receive_text()
        return item


@pytest.fixture
def ws_env(monkeypatch):
    access = {"u1": "write", "reader": "read"}

    async def _auth(websocket):
        return websocket.query_params["token"]

    async def _access(uid, thread_id):
        return access.get(uid)

    monkeypatch.setattr(ws_mod, "_authenticate_ws", _auth)
    monkeypatch.setattr(ws_mod, "_thread_access", _access)
    monkeypatch.setattr(ws_mod, "WS_TYPING_MIN_INTERVAL", 0.0)
    ws_mod.rooms.clear()
    return access


@pytest.mark.asyncio
async def test_ws_reader_cannot_broadcast_and_garbage_is_dropped(ws_env):
    peer = FakeWS([], uid="u1")
    ws_mod.rooms["t"].add(peer)
    reader = FakeWS(['{"type":"typing"}', '{"type":"message","message":{"text":"spoof"}}', "not json"], uid="reader")
    await ws_mod.chat_ws(reader, "t")
    assert peer.sent == []  # read-only socket relays nothing


@pytest.mark.asyncio
async def test_ws_writer_only_typing_relayed_with_server_fields(ws_env):
    peer = FakeWS([], uid="reader")
    ws_mod.rooms["t"].add(peer)
    writer = FakeWS(['{"type":"typing","x":"y"}', '{"type":"message","message":{"text":"spoof"}}', '[1]'], uid="u1")
    await ws_mod.chat_ws(writer, "t")
    assert [json.loads(x) for x in peer.sent] == [{"type": "typing", "user_id": "u1"}]


@pytest.mark.asyncio
async def test_ws_oversize_frame_closes_socket_and_unknown_user_refused(ws_env):
    s = FakeWS(["x" * 5000], uid="u1")
    await ws_mod.chat_ws(s, "t")
    assert s.closed == 1009
    nobody = FakeWS([], uid="nobody")
    await ws_mod.chat_ws(nobody, "t")
    assert nobody.closed == 4403 and not nobody.accepted


@pytest.mark.asyncio
async def test_ws_access_revalidated_while_connected(ws_env, monkeypatch):
    monkeypatch.setattr(ws_mod, "WS_ACCESS_RECHECK_SECONDS", 0.05)
    sock = FakeWS([0.12, '{"type":"typing"}'], uid="u1")

    async def _revoke():
        await asyncio.sleep(0.03)
        ws_env.pop("u1")

    task = asyncio.create_task(_revoke())
    await ws_mod.chat_ws(sock, "t")
    await task
    assert sock.closed == 4403
    assert sock not in ws_mod.rooms["t"]


@pytest.mark.asyncio
async def test_ws_revoke_event_closes_removed_user_sockets(ws_env):
    sock = FakeWS([], uid="u1")
    ws_mod.rooms["t"].add(sock)
    ws_mod.socket_users[sock] = "u1"
    ws_env.pop("u1")
    await ws_mod.recheck_user_access("t", "u1")
    assert sock.closed == 4403 and sock not in ws_mod.rooms["t"]
    ws_mod.socket_users.pop(sock, None)
