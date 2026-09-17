"""A portal access token must not be a full session.

`POST /auth/portal/session` exchanges a magic link for an ordinary access JWT,
because the portal snapshot and the checkout route need `Authorization: Bearer`
like any other request. The token carried `portal: True` and `project_id`, but
nothing read them — `get_current_user` and `require_project` see only the user.

So a link issued for one project, marked read-only, was a full session for that
user everywhere. Measured before the fix, on a live server:

    portal-link  {project_id: A, scopes: ["read"], read_only: true}
      → /auth/portal/session → access_token
      → GET   /projects/B     → 200   («Вторая квартира», план 34 465,1 ₽)
      → PATCH /projects/B     → 200   (a write, from a read-only link)

The link travels by SMS or email, so it lives in message history and carrier
logs. Whoever held it held the whole account.

These tests pin both halves — the token must *carry* the claims, and the API
must *enforce* them — because either one alone silently restores the hole.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.core.security import decode_access_token
from app.db.session import init_db
from app.main import app
from app.services import portal_token_service as portal_tok
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "portal_scope.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _two_projects(client):
    """A demo customer who owns two projects, and both ids.

    The escalation is only observable with a second project to reach, and the
    seeded demo has one, so this creates the other.
    """
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    headers = {"X-User-Id": customer["id"]}

    created = await client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "name": "Второй объект",
            "address": "ул. Вторая, 2",
            "rooms": [{"name": "Комната", "length_m": 4, "width_m": 3}],
        },
    )
    assert created.status_code in (200, 201), created.text

    projects = (await client.get("/api/v1/projects", headers=headers)).json()
    assert len(projects) >= 2, "the escalation needs a second project to reach"
    ids = [p["id"] for p in projects]
    return customer, ids[0], ids[1]


async def _portal_bearer(client, *, user_id, project_id, scopes):
    token = portal_tok.create_portal_token(
        project_id=project_id, user_id=user_id, scopes=scopes
    )
    session = await client.post("/api/v1/auth/portal/session", json={"token": token})
    assert session.status_code == 200, session.text
    return session.json()


# --- the token must carry what it is limited by -------------------------------


async def test_the_minted_token_carries_its_project_and_scopes():
    """Without these claims there is nothing downstream to enforce."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, _other = await _two_projects(client)
        body = await _portal_bearer(
            client, user_id=customer["id"], project_id=own, scopes=["read"]
        )

        payload = decode_access_token(body["access_token"])

        assert payload.get("portal") is True
        assert payload.get("project_id") == own
        assert payload.get("scopes") == ["read"]
        assert payload.get("read_only") is True


# --- the escalation itself ----------------------------------------------------


async def test_a_portal_token_cannot_read_another_project():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, other = await _two_projects(client)
        body = await _portal_bearer(
            client, user_id=customer["id"], project_id=own, scopes=["read"]
        )
        headers = {"Authorization": f"Bearer {body['access_token']}"}

        assert (await client.get(f"/api/v1/projects/{own}", headers=headers)).status_code == 200

        foreign = await client.get(f"/api/v1/projects/{other}", headers=headers)
        assert foreign.status_code == 403, foreign.text
        assert "portal_token_project_mismatch" in foreign.text


async def test_a_read_only_portal_token_cannot_write():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, _other = await _two_projects(client)
        body = await _portal_bearer(
            client, user_id=customer["id"], project_id=own, scopes=["read"]
        )
        headers = {"Authorization": f"Bearer {body['access_token']}"}

        # Its own project, so the refusal can only be about the method.
        written = await client.patch(
            f"/api/v1/projects/{own}", headers=headers, json={"name": "SCOPE PROBE"}
        )
        assert written.status_code == 403, written.text
        assert "portal_token_read_only" in written.text

        unchanged = (await client.get(f"/api/v1/projects/{own}", headers=headers)).json()
        assert unchanged["name"] != "SCOPE PROBE"


async def test_a_write_scope_still_allows_its_own_project():
    """The refusal must be about scope, not about being a portal token."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, other = await _two_projects(client)
        body = await _portal_bearer(
            client, user_id=customer["id"], project_id=own, scopes=["read", "pay"]
        )
        headers = {"Authorization": f"Bearer {body['access_token']}"}

        allowed = await client.patch(
            f"/api/v1/projects/{own}", headers=headers, json={"name": "Scoped write"}
        )
        assert allowed.status_code != 403, allowed.text

        # …and the project binding still holds for a scoped token.
        foreign = await client.patch(
            f"/api/v1/projects/{other}", headers=headers, json={"name": "nope"}
        )
        assert foreign.status_code == 403
        assert "portal_token_project_mismatch" in foreign.text


# --- what the portal legitimately needs ---------------------------------------


async def test_auth_me_does_not_hand_a_portal_link_a_fresh_session():
    """The bypass this module exists to prevent, and the one it first allowed.

    `/auth/me` is allowlisted because the portal screen needs to know who the
    link belongs to. It also used to answer with a newly minted access token —
    and that token carried no `portal` claim, so nothing downstream restricted
    it. One request turned a read-only link for project A into a full session
    with write access to project B.

    The first version of this test only asserted `status_code == 200`, which is
    exactly why it passed while the hole was open.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, other = await _two_projects(client)
        body = await _portal_bearer(
            client, user_id=customer["id"], project_id=own, scopes=["read"]
        )
        headers = {"Authorization": f"Bearer {body['access_token']}"}

        me = await client.get("/api/v1/auth/me", headers=headers)
        assert me.status_code == 200, me.text
        payload = me.json()

        assert payload["id"] == customer["id"], "the link must still identify its holder"
        assert not payload.get("access_token"), (
            "a portal link must not be able to trade /auth/me for an unrestricted token"
        )
        assert not payload.get("refresh_token")

        # And the restriction genuinely still holds afterwards.
        foreign = await client.get(f"/api/v1/projects/{other}", headers=headers)
        assert foreign.status_code == 403
        assert "portal_token_project_mismatch" in foreign.text


async def test_a_normal_session_still_gets_its_token_from_auth_me():
    """Guards the guard: withholding the token from everyone would also pass
    the test above, and would break ordinary sign-in."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"Authorization": f"Bearer {user['access_token']}"}

        me = await client.get("/api/v1/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json().get("access_token"), (
            "an ordinary session must keep refreshing its access token"
        )


async def test_the_portal_can_still_resolve_who_it_belongs_to():
    """The portal screen calls /auth/me, which carries no project id."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, _other = await _two_projects(client)
        body = await _portal_bearer(
            client, user_id=customer["id"], project_id=own, scopes=["read"]
        )
        headers = {"Authorization": f"Bearer {body['access_token']}"}

        me = await client.get("/api/v1/auth/me", headers=headers)
        assert me.status_code == 200, me.text
        assert me.json()["id"] == customer["id"]


async def test_the_portal_snapshot_still_works():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, _other = await _two_projects(client)
        body = await _portal_bearer(
            client, user_id=customer["id"], project_id=own, scopes=["read"]
        )
        headers = {"Authorization": f"Bearer {body['access_token']}"}

        snapshot = await client.get(
            f"/api/v1/portal/projects/{own}/snapshot", headers=headers
        )
        assert snapshot.status_code == 200, snapshot.text


# --- ordinary sessions are untouched ------------------------------------------


async def test_a_normal_token_is_not_restricted():
    """Guards the guard: if every token were restricted the suite would be red,
    but a narrower mistake — treating any token as a portal one — would not
    show up in the cases above."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        customer, own, other = await _two_projects(client)
        normal = (
            await client.post("/api/v1/auth/demo", json={"role": "customer"})
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {normal}"}

        assert (await client.get(f"/api/v1/projects/{own}", headers=headers)).status_code == 200
        assert (await client.get(f"/api/v1/projects/{other}", headers=headers)).status_code == 200
