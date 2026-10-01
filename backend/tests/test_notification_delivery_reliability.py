"""Push/notification reliability and role-correct links (COM-002/017/018/019/020/032/039/041)."""
import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    ChatThread,
    ChatThreadParticipant,
    DomainOutbox,
    Project,
    PushToken,
    User,
    UserRole,
)
from app.services import activity_service, automation_engine, notification_service, outbox_service
from app.services.notification_links import link_for_role, recipient_role


def test_link_for_role_swaps_only_the_group_and_is_idempotent():
    assert link_for_role("/(customer)/(tabs)/repair?tab=materials", "contractor") == "/(contractor)/(tabs)/repair?tab=materials"
    assert link_for_role("/(contractor)/(tabs)/", "customer") == "/(customer)/(tabs)/"
    assert link_for_role("/(customer)", "contractor") == "/(contractor)"
    assert link_for_role("/(customer)/(tabs)/budget", "customer") == "/(customer)/(tabs)/budget"
    assert link_for_role("/stage/s1", "contractor") == "/stage/s1"
    assert link_for_role("/(customerx)/a", "contractor") == "/(customerx)/a"
    assert link_for_role(None, "contractor") is None
    assert link_for_role("/(customer)/x", None) == "/(customer)/x"
    once = link_for_role("/(customer)/(tabs)/chat", "contractor")
    assert link_for_role(once, "contractor") == once


async def _seed(db):
    customer = User(id="n-cu", phone="+79990010001", role=UserRole.customer)
    contractor = User(id="n-co", phone="+79990010002", role=UserRole.contractor)
    project = Project(
        id="n-p", name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id, budget_planned=1, budget_spent=0,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


@pytest.mark.asyncio
async def test_notify_is_role_aware_and_defers_push_to_outbox(db, monkeypatch):
    _customer, contractor, project = await _seed(db)
    pushed: list[dict] = []

    async def fake_push(_db, user_id, title, body, data=None, *, delivery_id=None):
        pushed.append({"user_id": user_id, "data": data})
        return True

    monkeypatch.setattr(notification_service, "send_push", fake_push)

    notification = await notification_service.notify(
        db,
        user_id=contractor.id,
        project_id=project.id,
        notification_type="materials",
        title="Материалы",
        body="b",
        link_path="/(customer)/(tabs)/repair?tab=materials",
        return_to="/(customer)/(tabs)/",
    )
    # in-app row is committed, link is built for the contractor, push has NOT run inline
    assert notification.link_path.startswith("/(contractor)/(tabs)/repair?tab=materials")
    assert "(customer)" not in notification.link_path
    assert pushed == []
    rows = list((await db.execute(select(DomainOutbox))).scalars().all())
    assert len(rows) == 1 and rows[0].event_type == outbox_service.NOTIFICATION_EVENT
    assert json.loads(rows[0].payload_json)["role"] == "contractor"

    assert await outbox_service.dispatch_pending(db, limit=5) == 1
    assert len(pushed) == 1
    data = pushed[0]["data"]
    assert data["role"] == "contractor"
    assert data["link_path"] == "/(contractor)/(tabs)/repair?tab=materials"
    assert data["returnTo"] == "/(contractor)/(tabs)/"
    # one in-app record only (the outbox handler reuses it)
    assert await db.scalar(select(func.count()).select_from(AppNotification)) == 1
    assert await recipient_role(db, "missing") is None


@pytest.mark.asyncio
async def test_exhausted_push_keeps_in_app_record_and_flags_poisoned_outbox(db, monkeypatch, caplog):
    customer, _contractor, project = await _seed(db)
    calls = {"n": 0}

    async def failing_push(*_a, **_k):
        calls["n"] += 1
        return False

    monkeypatch.setattr(notification_service, "send_push", failing_push)
    monkeypatch.setattr(outbox_service, "_retry_delay", lambda _attempts: __import__("datetime").timedelta(0))

    notification = await notification_service.notify(
        db, user_id=customer.id, project_id=project.id, notification_type="document",
        title="t", body="b", link_path="/documents",
    )
    nid = notification.id
    for _ in range(outbox_service.MAX_ATTEMPTS + 2):
        await outbox_service.dispatch_pending(db, limit=5)

    assert calls["n"] == outbox_service.MAX_ATTEMPTS  # stops retrying after exhaustion
    assert await db.get(AppNotification, nid) is not None  # nothing lost for the user
    snapshot = await outbox_service.runtime_snapshot(db)
    assert snapshot["poisoned"] == 1  # the existing ops alert/dead-letter signal
    assert "outbox poisoned" in caplog.text


@pytest.mark.asyncio
async def test_acceptance_automation_sends_no_second_payment_prompt(db):
    customer, _contractor, project = await _seed(db)
    from app.models.entities import Stage

    stage = Stage(id="n-st", project_id=project.id, name="Этап", sort_order=1)
    db.add(stage)
    await db.commit()
    actions = await automation_engine.prepare_event_effects(
        db, kind="AcceptancePassed", project_id=project.id, user_id=customer.id, stage_id=stage.id,
    )
    await db.commit()
    assert "payment_allowed" in actions
    assert "payment_unlock_notified" not in actions
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_material_delivered_does_not_notify_acting_contractor(db):
    _customer, contractor, project = await _seed(db)
    await automation_engine.prepare_event_effects(
        db, kind="MaterialDelivered", project_id=project.id, user_id=contractor.id,
    )
    await db.commit()
    assert await db.scalar(select(func.count()).select_from(DomainOutbox)) == 0


@pytest.mark.asyncio
async def test_project_feed_kind_groups_match_camelcase_emitters(db):
    _customer, _contractor, project = await _seed(db)
    for kind in ("MaterialOrdered", "MaterialCalculated", "AcceptancePassed", "ScheduleConfirmed", "ExpenseAdded", "RoomCreated", "WorkCompleted"):
        db.add(ActivityEvent(project_id=project.id, kind=kind, title=kind))
    await db.commit()

    async def kinds(kind):
        return sorted(i["kind"] for i in await activity_service.project_feed(db, project.id, kind=kind))

    assert await kinds("material") == ["MaterialCalculated", "MaterialOrdered"]
    assert await kinds("approval") == ["AcceptancePassed", "ScheduleConfirmed"]
    assert await kinds("room_change") == ["RoomCreated"]
    assert await kinds("payment") == ["ExpenseAdded"]
    assert await kinds("WorkCompleted") == ["WorkCompleted"]  # exact kinds keep working
    assert len(await kinds(None)) == 7


async def _client(db, user):
    async def _db():
        yield db

    async def _user():
        return user

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_push_unregister_is_idempotent_and_touches_only_own_tokens(db):
    customer, contractor, _project = await _seed(db)
    mine = "ExponentPushToken[mine-token-1]"
    other = "ExponentPushToken[other-token-2]"
    db.add_all([
        PushToken(user_id=customer.id, token=mine),
        PushToken(user_id=customer.id, token="ExponentPushToken[mine-token-3]"),
        PushToken(user_id=contractor.id, token=other),
    ])
    await db.commit()
    try:
        async with await _client(db, customer) as c:
            r = await c.post("/api/v1/push/unregister", json={"token": mine})
            assert r.status_code == 200 and r.json()["removed"] == 1
            again = await c.post("/api/v1/push/unregister", json={"token": mine})
            assert again.status_code == 200 and again.json()["removed"] == 0
            # someone else's token is never removed by this caller
            foreign = await c.post("/api/v1/push/unregister", json={"token": other})
            assert foreign.status_code == 200 and foreign.json()["removed"] == 0
            assert await db.scalar(select(func.count()).select_from(PushToken).where(PushToken.user_id == contractor.id)) == 1
            rest = await c.delete("/api/v1/push/token")
            assert rest.json()["removed"] == 1
            assert await db.scalar(select(func.count()).select_from(PushToken).where(PushToken.user_id == customer.id)) == 0
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_chat_invite_response_does_not_reveal_registration(db, monkeypatch):
    customer, _contractor, project = await _seed(db)
    thread = ChatThread(id="n-th", project_id=project.id, title="T", created_by=customer.id)
    registered = User(id="n-reg", phone="+79990010009", role=UserRole.customer, profile_code="ABC123")
    db.add_all([thread, registered])
    await db.commit()
    from app.services import outbox_inline_dispatch

    async def no_dispatch(*_a, **_k):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_dispatch)
    try:
        async with await _client(db, customer) as c:
            url = f"/api/v1/projects/{project.id}/chats/{thread.id}/invite"
            known_code = await c.post(url, json={"profile_code": "ABC123"})
            unknown_code = await c.post(url, json={"profile_code": "FFFFFF"})
            known_phone = await c.post(url, json={"phone": "+79990010009"})
            unknown_phone = await c.post(url, json={"phone": "+79990019999"})
    finally:
        app.dependency_overrides.clear()
    bodies = []
    for r in (known_code, unknown_code, known_phone, unknown_phone):
        assert r.status_code == 200, r.text
        body = r.json()
        bodies.append(body)
        assert body["delivery_channel"] == "invitation"
        assert body["delivery_status"] == "processed"
        assert body["user_id"] is None and body["status"] == "invited"
    assert set(bodies[0]) == set(bodies[1]) == set(bodies[2]) == set(bodies[3])
    # nothing is created for a code that matches nobody
    assert await db.scalar(
        select(func.count()).select_from(ChatThreadParticipant).where(ChatThreadParticipant.thread_id == thread.id)
    ) == 2
