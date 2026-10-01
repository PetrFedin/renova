"""COM-036 (guests/team-viewers lose money threads) and JRN-009 (invited participant can post)."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    ChatMessage,
    ChatMessageType,
    ChatThread,
    ChatThreadParticipant,
    Project,
    ProjectViewer,
    Team,
    TeamMember,
    User,
    UserRole,
)

P = "/api/v1/projects/mv-pr"


async def _seed(db):
    customer = User(id="mv-cu", phone="+79990008001", role=UserRole.customer, full_name="Customer")
    contractor = User(id="mv-ct", phone="+79990008002", role=UserRole.contractor, full_name="Contractor")
    guest = User(id="mv-gu", phone="+79990008003", role=UserRole.customer, full_name="Guest")
    viewer = User(id="mv-vw", phone="+79990008004", role=UserRole.contractor, full_name="Viewer")
    member = User(id="mv-mb", phone="+79990008005", role=UserRole.contractor, full_name="Member")
    invited = User(id="mv-inv", phone="+79990008006", role=UserRole.contractor, full_name="Invited", profile_code="MV0001")
    project = Project(
        id="mv-pr", name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id, budget_planned=1, budget_spent=0,
    )
    team = Team(id="mv-team", name="T", owner_id=contractor.id)
    general = ChatThread(id="mv-general", project_id=project.id, title="Общий", topic="general", created_by=customer.id)
    pay = ChatThread(id="mv-pay", project_id=project.id, title="Оплата", topic="payment", created_by=customer.id)
    invoiced = ChatThread(id="mv-inv-th", project_id=project.id, title="Разное", topic="general", created_by=customer.id)
    db.add_all([customer, contractor, guest, viewer, member, invited, project, team, general, pay, invoiced])
    await db.flush()
    db.add_all([
        ProjectViewer(project_id=project.id, user_id=guest.id),
        TeamMember(team_id=team.id, user_id=viewer.id, role="viewer"),
        TeamMember(team_id=team.id, user_id=member.id, role="member"),
        ChatThreadParticipant(id="mv-part", thread_id=general.id, user_id=invited.id, invited_by=customer.id, status="active"),
        ChatMessage(id="mv-m1", thread_id=general.id, user_id=customer.id, author_role="customer", message_type=ChatMessageType.text, text="привет"),
        ChatMessage(id="mv-m2", thread_id=pay.id, user_id=customer.id, author_role="customer", message_type=ChatMessageType.text, text="оплатил аванс"),
        ChatMessage(id="mv-m3", thread_id=invoiced.id, user_id=contractor.id, author_role="contractor", message_type=ChatMessageType.invoice, text="Счёт 5000"),
    ])
    await db.commit()
    return dict(customer=customer, contractor=contractor, guest=guest, viewer=viewer, member=member, invited=invited)


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


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["guest", "viewer"])
async def test_guest_and_team_viewer_do_not_see_money_threads(db, who):
    s = await _seed(db)
    async with await _client(db, s[who]) as c:
        listed = await c.get(f"{P}/chats")
        assert listed.status_code == 200
        assert {t["id"] for t in listed.json()} == {"mv-general"}
        assert (await c.get(f"{P}/chats/mv-general")).status_code == 200
        for tid in ("mv-pay", "mv-inv-th"):
            denied = await c.get(f"{P}/chats/{tid}")
            assert denied.status_code == 403
            assert denied.status_code == 403
        found = await c.get(f"{P}/chats/search", params={"q": "аванс"})
        assert found.status_code == 200 and found.json() == []
        inbox = await c.get("/api/v1/chats/inbox")
        assert {t["id"] for t in inbox.json()} == {"mv-general"}


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["customer", "contractor", "member"])
async def test_project_writers_still_see_money_threads(db, who):
    s = await _seed(db)
    async with await _client(db, s[who]) as c:
        listed = await c.get(f"{P}/chats")
        assert {t["id"] for t in listed.json()} == {"mv-general", "mv-pay", "mv-inv-th"}
        assert (await c.get(f"{P}/chats/mv-pay")).status_code == 200
        found = await c.get(f"{P}/chats/search", params={"q": "аванс"})
        assert len(found.json()) == 1


@pytest.mark.asyncio
async def test_invited_participant_can_post_text_but_not_finance_types(db):
    s = await _seed(db)
    async with await _client(db, s["invited"]) as c:
        ok = await c.post(f"{P}/chats/mv-general/messages", json={"client_request_id": "mv-post-0001", "text": "Я на связи"})
        assert ok.status_code == 200, ok.text
        assert ok.json()["text"] == "Я на связи"
        confirm = await c.post(f"{P}/chats/mv-general/messages", json={"client_request_id": "mv-post-0002", "text": "x", "message_type": "confirm"})
        assert confirm.status_code == 403
        sibling = await c.post(f"{P}/chats/mv-pay/messages", json={"client_request_id": "mv-post-0003", "text": "x"})
        assert sibling.status_code == 403


@pytest.mark.asyncio
async def test_guest_still_cannot_post(db):
    s = await _seed(db)
    async with await _client(db, s["guest"]) as c:
        r = await c.post(f"{P}/chats/mv-general/messages", json={"client_request_id": "mv-post-0004", "text": "x"})
    assert r.status_code == 403
