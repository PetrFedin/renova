"""MKT-012: владелец убирает участника, участник выходит; назначения снимаются."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import Project, Stage, StageStatus, TeamMember, User, UserRole
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


async def _seed(db):
    owner = User(id="tr-owner", phone="+79990009001", role=UserRole.contractor)
    member = User(id="tr-member", phone="+79990009002", role=UserRole.contractor)
    other = User(id="tr-other", phone="+79990009003", role=UserRole.contractor)
    cust = User(id="tr-cust", phone="+79990009004", role=UserRole.customer)
    project = Project(id="tr-proj", name="Кв", renovation_type="cosmetic", customer_id=cust.id,
                      contractor_id=owner.id)
    db.add_all([owner, member, other, cust, project])
    await db.flush()
    active = Stage(id="tr-s1", project_id=project.id, name="A", sort_order=0,
                   assignee_id=member.id, status=StageStatus.active)
    done = Stage(id="tr-s2", project_id=project.id, name="B", sort_order=1,
                 assignee_id=member.id, status=StageStatus.done)
    db.add_all([active, done])
    await db.commit()
    team = (await team_svc.create_or_get_team(db, owner.id, "Бригада")).team
    await team_svc.ensure_team_membership(db, team_id=team.id, user_id=member.id, role="member")
    await team_svc.ensure_team_membership(db, team_id=team.id, user_id=other.id, role="viewer")
    await db.commit()
    team_id = team.id
    team = type("T", (), {"id": team_id})()
    for u in (owner, member, other):
        u.id  # noqa: B018 — загрузить до expire_all
    return owner, member, other, team


async def _member_ids(db, team_id):
    db.expire_all()
    return {m.user_id for m in (await db.scalars(select(TeamMember).where(TeamMember.team_id == team_id))).all()}


@pytest.mark.asyncio
async def test_owner_removes_member_and_open_assignments_released(db):
    owner, member, other, team = await _seed(db)
    r = await _call(db, owner, "DELETE", f"/api/v1/teams/members/tr-member")
    assert r.status_code == 200, r.text
    assert r.json()["released_stage_assignments"] == 1
    assert "tr-member" not in await _member_ids(db, team.id)
    db.expire_all()
    assert (await db.get(Stage, "tr-s1")).assignee_id is None
    assert (await db.get(Stage, "tr-s2")).assignee_id == "tr-member"  # закрытый этап — история
    # доступ к объектам владельца пропал
    assert (await _call(db, member, "GET", "/api/v1/projects/tr-proj")).status_code == 403


@pytest.mark.asyncio
async def test_remove_acl_and_owner_protected(db):
    owner, member, other, team = await _seed(db)
    # посторонний участник не может удалять
    r = await _call(db, member, "DELETE", f"/api/v1/teams/members/tr-other")
    assert r.status_code in (403, 404, 409)
    assert "tr-other" in await _member_ids(db, team.id)
    # владельца удалить нельзя
    r = await _call(db, owner, "DELETE", f"/api/v1/teams/members/tr-owner")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "team_last_owner_cannot_be_removed"
    assert "tr-owner" in await _member_ids(db, team.id)
    # неизвестный участник
    r = await _call(db, owner, "DELETE", "/api/v1/teams/members/nobody")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_member_leaves_owner_cannot(db):
    owner, member, other, team = await _seed(db)
    r = await _call(db, member, "POST", "/api/v1/teams/leave")
    assert r.status_code == 200, r.text
    assert "tr-member" not in await _member_ids(db, team.id)
    db.expire_all()
    assert (await db.get(Stage, "tr-s1")).assignee_id is None
    again = await _call(db, member, "POST", "/api/v1/teams/leave")
    assert again.status_code == 404
    r = await _call(db, owner, "POST", "/api/v1/teams/leave")
    assert r.status_code == 409
    assert "tr-owner" in await _member_ids(db, team.id)


@pytest.mark.asyncio
async def test_owner_lists_and_revokes_invites_and_revoked_link_cannot_join(db):
    """MKT-012: владелец видит действующие приглашения и отзывает; отозванная ссылка не принимается."""
    owner, member, other, team = await _seed(db)
    link = (await _call(db, owner, "POST", "/api/v1/teams/invite-link", json={"role": "member"})).json()
    items = (await _call(db, owner, "GET", "/api/v1/teams/invites")).json()["items"]
    assert len(items) == 1 and items[0]["kind"] == "link" and "token" not in items[0]
    invite_id = items[0]["id"]
    # чужой владелец (не его бригада) — 404; участник-не-владелец тоже
    r = await _call(db, other, "DELETE", f"/api/v1/teams/invites/{invite_id}")
    assert r.status_code == 404
    assert (await _call(db, owner, "DELETE", f"/api/v1/teams/invites/{invite_id}")).status_code == 200
    assert (await _call(db, owner, "GET", "/api/v1/teams/invites")).json()["items"] == []
    assert (await _call(db, owner, "DELETE", f"/api/v1/teams/invites/{invite_id}")).status_code == 404
    newcomer = User(id="tr-newcomer", phone="+79990009005", role=UserRole.contractor)
    db.add(newcomer)
    await db.commit()
    joined = await _call(db, newcomer, "POST", "/api/v1/teams/join", json={"token": link["token"]})
    assert joined.json().get("ok") is False  # контракт join: 200 + ok:false
    assert "tr-newcomer" not in await _member_ids(db, team.id)
