"""Chat participant list contains real project members, not only invitees; ACL keeps contacts private."""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.models.entities import (
    ChatThread,
    ChatThreadParticipant,
    Project,
    Team,
    TeamMember,
    User,
    UserRole,
)
from app.services import chat_service as chat_svc


def _user(uid: str, phone: str, role: UserRole, name: str) -> User:
    return User(id=uid, phone=phone, role=role, full_name=name, profile_code=uid[-6:].upper())


@pytest.mark.asyncio
async def test_list_participants_includes_project_members_and_hides_contacts_from_thread_only():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with Session() as db:
            cust = _user("lp-cust", "+79990001001", UserRole.customer, "Заказчик")
            con = _user("lp-con", "+79990001002", UserRole.contractor, "Подрядчик")
            mate = _user("lp-mate", "+79990001003", UserRole.contractor, "Бригадир")
            inv = _user("lp-inv", "+79990001004", UserRole.contractor, "Приглашённый")
            out = _user("lp-out", "+79990001005", UserRole.contractor, "Посторонний")
            proj = Project(id="lp-proj", name="P", renovation_type="cosmetic", customer_id=cust.id, contractor_id=con.id)
            thread = ChatThread(id="lp-thr", project_id=proj.id, title="T", created_by=cust.id)
            team = Team(id="lp-team", name="Team", owner_id=con.id)
            db.add_all([cust, con, mate, inv, out, proj, thread, team])
            await db.flush()
            db.add_all([
                TeamMember(team_id=team.id, user_id=mate.id, role="foreman"),
                ChatThreadParticipant(id="lp-p1", thread_id=thread.id, user_id=inv.id, invited_by=cust.id, status="active"),
                # invited AND a project member: must not be listed twice
                ChatThreadParticipant(id="lp-p2", thread_id=thread.id, user_id=mate.id, invited_by=cust.id, status="active"),
            ])
            await db.commit()

            rows = await chat_svc.list_participants(db, thread.id, cust)
            by_user = {r["user_id"]: r for r in rows}
            assert set(by_user) == {cust.id, con.id, mate.id, inv.id}
            assert len(rows) == 4
            assert out.id not in by_user
            assert by_user[cust.id]["role"] == "customer"
            assert by_user[con.id]["role"] == "contractor"
            assert by_user[mate.id]["role"] == "team_foreman"
            assert by_user[inv.id]["role"] == "invited"
            assert by_user[con.id]["phone"] == con.phone  # project authority sees contacts

            # Thread-only invitee: same people, no contact data.
            rows = await chat_svc.list_participants(db, thread.id, inv)
            assert len(rows) == 4
            assert all(r["phone"] is None and r["profile_code"] is None for r in rows)

            # Unknown viewer fails closed.
            rows = await chat_svc.list_participants(db, thread.id)
            assert all(r["phone"] is None and r["profile_code"] is None for r in rows)

            # Unknown thread: empty, no crash.
            assert await chat_svc.list_participants(db, "nope", cust) == []
    finally:
        await engine.dispose()
