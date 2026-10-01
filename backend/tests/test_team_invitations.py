"""MKT-013/022/036/037: приглашение с принятием, нейтральный ответ, ограничения SMS."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.core.rate_limit import rate_limiter
from app.db.session import get_db
from app.main import app
from app.models.entities import DomainOutbox, Team, TeamInvite, TeamMember, User, UserRole
from app.services import team_service as team_svc


async def _call(db, actor, method, url, **kw):
    await db.refresh(actor)

    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.request(method, url, **kw)
    finally:
        app.dependency_overrides.clear()


async def _seed(db, tag):
    owner = User(id=f"{tag}-owner", phone=f"+7999{abs(hash(tag)) % 10**7:07d}", role=UserRole.contractor)
    invitee = User(id=f"{tag}-invitee", phone=f"+7998{abs(hash(tag + 'i')) % 10**7:07d}", role=UserRole.contractor)
    stranger = User(id=f"{tag}-stranger", phone=f"+7997{abs(hash(tag + 's')) % 10**7:07d}", role=UserRole.contractor)
    cust = User(id=f"{tag}-cust", phone=f"+7996{abs(hash(tag + 'c')) % 10**7:07d}", role=UserRole.customer)
    db.add_all([owner, invitee, stranger, cust])
    await db.commit()
    team = (await team_svc.create_or_get_team(db, owner.id, "Бригада")).team
    return owner, invitee, stranger, cust, team.id


async def _members(db, team_id):
    db.expire_all()
    return {m.user_id for m in (await db.scalars(select(TeamMember).where(TeamMember.team_id == team_id))).all()}


@pytest.mark.asyncio
async def test_phone_invite_is_pending_until_accepted(db):
    owner, invitee, _s, _c, team_id = await _seed(db, "pi1")
    phone = invitee.phone
    r = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": phone, "role": "viewer"})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "status": "sent", "message": "Приглашение отправлено"}
    assert invitee.id not in await _members(db, team_id)  # без согласия — не член

    inbox = await _call(db, invitee, "GET", "/api/v1/teams/invitations")
    items = inbox.json()["items"]
    assert len(items) == 1 and items[0]["team_name"] == "Бригада" and items[0]["role"] == "viewer"
    # повторное приглашение идемпотентно
    again = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": phone, "role": "member"})
    assert again.status_code == 200
    items = (await _call(db, invitee, "GET", "/api/v1/teams/invitations")).json()["items"]
    assert len(items) == 1 and items[0]["role"] == "member"

    ok = await _call(db, invitee, "POST", f"/api/v1/teams/invitations/{items[0]['id']}/accept")
    assert ok.status_code == 200 and ok.json()["status"] == "accepted"
    assert invitee.id in await _members(db, team_id)
    # повторное принятие — 404, список пуст
    assert (await _call(db, invitee, "POST", f"/api/v1/teams/invitations/{items[0]['id']}/accept")).status_code == 404
    assert (await _call(db, invitee, "GET", "/api/v1/teams/invitations")).json()["items"] == []
    # уже в бригаде — понятный код
    dup = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": phone})
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "already_member"


@pytest.mark.asyncio
async def test_decline_does_not_add_member_and_only_invitee_can_answer(db):
    owner, invitee, stranger, _c, team_id = await _seed(db, "pi2")
    await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": invitee.phone})
    inv_id = (await _call(db, invitee, "GET", "/api/v1/teams/invitations")).json()["items"][0]["id"]
    # чужой исполнитель принять чужое приглашение не может
    assert (await _call(db, stranger, "POST", f"/api/v1/teams/invitations/{inv_id}/accept")).status_code == 404
    assert (await _call(db, invitee, "POST", f"/api/v1/teams/invitations/{inv_id}/decline")).json()["status"] == "declined"
    assert invitee.id not in await _members(db, team_id)
    assert (await _call(db, invitee, "POST", f"/api/v1/teams/invitations/{inv_id}/accept")).status_code == 404


@pytest.mark.asyncio
async def test_unknown_number_and_customer_number_get_same_neutral_reply(db):
    owner, invitee, _s, cust, team_id = await _seed(db, "pi3")
    known = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": invitee.phone})
    unknown = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": "+79001112233"})
    as_customer = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": cust.phone})
    assert known.json() == unknown.json() == as_customer.json()
    assert known.status_code == unknown.status_code == as_customer.status_code == 200
    # приглашение создано только для реального исполнителя
    n = await db.scalar(select(func.count()).select_from(TeamInvite).where(TeamInvite.team_id == team_id))
    assert n == 1


@pytest.mark.asyncio
async def test_invalid_phone_and_role_are_422_not_200(db):
    owner, *_rest = await _seed(db, "pi4")
    bad = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": "abc123"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_phone"
    role = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": "+79001112233", "role": "owner"})
    assert role.status_code == 422 and role.json()["detail"]["code"] == "invalid_team_role"


@pytest.mark.asyncio
async def test_phone_format_is_normalized_on_lookup(db):
    owner, invitee, *_r, team_id = await _seed(db, "pi5")
    digits = invitee.phone[2:]  # +7XXXXXXXXXX -> XXXXXXXXXX
    spaced = f"+7 {digits[:3]} {digits[3:6]}-{digits[6:8]}-{digits[8:]}"
    r = await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": spaced})
    assert r.status_code == 200
    assert len((await _call(db, invitee, "GET", "/api/v1/teams/invitations")).json()["items"]) == 1


@pytest.mark.asyncio
async def test_personal_invite_token_cannot_be_used_via_join(db):
    owner, invitee, stranger, _c, team_id = await _seed(db, "pi6")
    stranger_id = stranger.id
    await _call(db, owner, "POST", "/api/v1/teams/invite", json={"phone": invitee.phone})
    token = await db.scalar(select(TeamInvite.token).where(TeamInvite.team_id == team_id))
    r = await _call(db, stranger, "POST", "/api/v1/teams/join", json={"token": token})
    assert r.json()["ok"] is False
    assert stranger_id not in await _members(db, team_id)


@pytest.mark.asyncio
async def test_non_owner_cannot_invite(db):
    owner, invitee, stranger, _c, team_id = await _seed(db, "pi7")
    r = await _call(db, stranger, "POST", "/api/v1/teams/invite", json={"phone": invitee.phone})
    assert r.status_code == 404  # у stranger нет своей бригады
    assert await db.scalar(select(func.count()).select_from(TeamInvite).where(TeamInvite.team_id == team_id)) == 0


@pytest.mark.asyncio
async def test_invite_sms_owner_only_normalized_and_rate_limited(db, monkeypatch):
    sent = []

    class _Res:
        delivered = False
        preview = True

    async def fake_send(phone, text):
        sent.append(phone)
        return _Res()

    monkeypatch.setattr("app.services.sms_service.send_sms", fake_send)
    owner, invitee, stranger, _c, team_id = await _seed(db, "pi8")
    # не владелец -> 403, SMS не ушло
    r = await _call(db, stranger, "POST", "/api/v1/teams/invite-sms", json={"phone": "+79005550001"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "team_owner_only"
    assert sent == []
    # мусорный номер -> 422
    assert (await _call(db, owner, "POST", "/api/v1/teams/invite-sms", json={"phone": "12ab"})).status_code == 422
    # нормализация: разные форматы одного номера уходят как +7...
    target = "+79005550777"
    for fmt in ("8 900 555-07-77", "+7(900)555-07-77", "9005550777"):
        r = await _call(db, owner, "POST", "/api/v1/teams/invite-sms", json={"phone": fmt})
        if r.status_code == 200:
            assert sent[-1] == target
    # лимит на номер: 3 в сутки (четвёртая — 429)
    assert len(sent) == 3
    r = await _call(db, owner, "POST", "/api/v1/teams/invite-sms", json={"phone": target})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "sms_phone_limit"
    assert "retry-after" in {k.lower() for k in r.headers}
    # SMS не создаёт команду для исполнителя без бригады
    nobody = User(id="pi8-nobody", phone="+79005550888", role=UserRole.contractor)
    db.add(nobody)
    await db.commit()
    r = await _call(db, nobody, "POST", "/api/v1/teams/invite-sms", json={"phone": "+79005550999"})
    assert r.status_code == 403
    assert await db.scalar(select(func.count()).select_from(Team).where(Team.owner_id == nobody.id)) == 0


@pytest.mark.asyncio
async def test_invite_sms_per_user_limit(db, monkeypatch):
    async def fake_send(phone, text):
        return type("R", (), {"delivered": False, "preview": True})()

    monkeypatch.setattr("app.services.sms_service.send_sms", fake_send)
    owner, *_rest = await _seed(db, "pi9")
    codes = []
    for i in range(12):
        r = await _call(db, owner, "POST", "/api/v1/teams/invite-sms", json={"phone": f"+7900666{i:04d}"})
        codes.append(r.status_code)
    assert codes[:10] == [200] * 10
    assert codes[10:] == [429, 429]


@pytest.mark.asyncio
async def test_member_of_foreign_team_does_not_get_own_team_from_invite_link(db):
    owner, invitee, stranger, _c, team_id = await _seed(db, "pi10")
    invitee_id = invitee.id
    await team_svc.ensure_team_membership(db, team_id=team_id, user_id=invitee_id, role="member")
    await db.commit()
    r = await _call(db, invitee, "POST", "/api/v1/teams/invite-link", json={"role": "member"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "team_owner_only"
    assert await db.scalar(select(func.count()).select_from(Team).where(Team.owner_id == invitee_id)) == 0
    # а исполнитель без бригады по-прежнему может создать её явным действием «создать ссылку»
    ok = await _call(db, stranger, "POST", "/api/v1/teams/invite-link", json={"role": "member"})
    assert ok.status_code == 200 and ok.json()["team_replayed"] is False
