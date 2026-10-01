"""COM-005/007/027/021: who gets notified, inbox set, one-shot lifecycle events, invoice reminders."""
from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.chat_inbox import _user_projects
from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import (
    ChatThread,
    DomainOutbox,
    Payment,
    PaymentStatus,
    PaymentType,
    Project,
    ProjectViewer,
    Stage,
    Team,
    TeamMember,
    User,
    UserRole,
)
from app.models.technical_supervision import ProjectTechnicalSupervisorAssignment
from app.services import chat_message_mutation as chat_mut
from app.services import lifecycle_notifications as lifecycle
from app.services import notification_recipients as rec


def _user(uid: str, role: UserRole = UserRole.contractor) -> User:
    return User(id=uid, phone=f"+7999{abs(hash(uid)) % 10**7:07d}", role=role, full_name=uid, profile_code=uid[-6:].upper())


@pytest.fixture
async def world():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as db:
        users = {
            "cust": _user("nr-cust", UserRole.customer),
            "lead": _user("nr-lead"),
            "foreman": _user("nr-foreman"),
            "member": _user("nr-member"),
            "viewer": _user("nr-viewer"),
            "other": _user("nr-other"),
            "guest": _user("nr-guest", UserRole.customer),
            "sup": _user("nr-sup"),
        }
        db.add_all(users.values())
        proj = Project(id="nr-proj", name="Объект", renovation_type="cosmetic",
                       customer_id="nr-cust", contractor_id="nr-lead")
        team = Team(id="nr-team", name="T", owner_id="nr-lead")
        db.add_all([proj, team])
        await db.flush()
        stage = Stage(id="nr-stage", project_id=proj.id, name="Электрика", sort_order=1, assignee_id="nr-member")
        db.add_all([
            stage,
            Stage(id="nr-stage2", project_id=proj.id, name="Плитка", sort_order=2),
            TeamMember(team_id=team.id, user_id="nr-foreman", role="foreman"),
            TeamMember(team_id=team.id, user_id="nr-member", role="member"),
            TeamMember(team_id=team.id, user_id="nr-viewer", role="viewer"),
            ProjectViewer(project_id=proj.id, user_id="nr-guest"),
            ProjectTechnicalSupervisorAssignment(
                project_id=proj.id, representative_user_id="nr-sup", provider_type="individual",
                provider_name="Технадзор", appointed_by_user_id="nr-cust",
            ),
            ChatThread(id="nr-thread", project_id=proj.id, title="Общий", created_by="nr-cust"),
        ])
        await db.commit()
        yield db, proj
    await engine.dispose()


@pytest.mark.asyncio
async def test_recipients_by_event_kind(world):
    db, proj = world
    chat = await rec.project_recipients(db, proj, rec.CHAT)
    assert chat == {"nr-cust", "nr-lead", "nr-foreman", "nr-viewer", "nr-guest", "nr-sup"}
    assert "nr-member" not in chat and "nr-other" not in chat

    quality = await rec.project_recipients(db, proj, rec.QUALITY, stage_id="nr-stage")
    assert "nr-member" in quality and "nr-sup" in quality
    # член бригады — только по назначенному ему этапу
    assert "nr-member" not in await rec.project_recipients(db, proj, rec.QUALITY, stage_id="nr-stage2")

    for kind in (rec.MONEY, rec.CONTRACT):
        assert await rec.project_recipients(db, proj, kind, stage_id="nr-stage") == {"nr-cust", "nr-lead"}

    assert await rec.project_recipients(db, proj, rec.CHAT, exclude=("nr-cust", "nr-sup")) == {
        "nr-lead", "nr-foreman", "nr-viewer", "nr-guest"
    }


@pytest.mark.asyncio
async def test_chat_without_contractor_has_no_recipients_hint(world):
    db, proj = world
    assert await chat_mut.thread_has_other_recipients(db, thread_id="nr-thread", sender_id="nr-cust")
    proj.contractor_id = None
    await db.execute(ProjectViewer.__table__.delete())
    await db.execute(ProjectTechnicalSupervisorAssignment.__table__.delete())
    await db.commit()
    assert not await chat_mut.thread_has_other_recipients(db, thread_id="nr-thread", sender_id="nr-cust")


@pytest.mark.asyncio
async def test_inbox_set_covers_team_guest_supervisor_and_skips_trash(world):
    db, proj = world
    for uid in ("nr-cust", "nr-lead", "nr-foreman", "nr-member", "nr-viewer", "nr-guest", "nr-sup"):
        user = await db.get(User, uid)
        assert [pid for pid, _ in await _user_projects(db, user)] == [proj.id], uid
    assert await _user_projects(db, await db.get(User, "nr-other")) == []

    proj.trashed_at = utc_now()
    await db.commit()
    for uid in ("nr-cust", "nr-lead", "nr-foreman", "nr-guest", "nr-sup"):
        assert await _user_projects(db, await db.get(User, uid)) == [], uid


async def _outbox_count(db) -> int:
    return int(await db.scalar(select(func.count()).select_from(DomainOutbox)) or 0)


@pytest.mark.asyncio
async def test_assignment_notification_is_sent_once(world, monkeypatch):
    db, proj = world

    async def no_dispatch(*_a, **_k):
        return 0

    monkeypatch.setattr("app.services.outbox_inline_dispatch.dispatch_best_effort", no_dispatch)
    first = await lifecycle.notify_contractor_assigned(db, project_id=proj.id, contractor_id="nr-lead", actor_id="nr-cust")
    again = await lifecycle.notify_contractor_assigned(db, project_id=proj.id, contractor_id="nr-lead", actor_id="nr-cust")
    assert (first, again) == (1, 0)
    assert await _outbox_count(db) == 1
    # назначивший не уведомляет сам себя
    assert await lifecycle.notify_contractor_assigned(db, project_id=proj.id, contractor_id="nr-cust", actor_id="nr-cust") == 0


@pytest.mark.asyncio
async def test_lead_conversion_notifies_counterpart_once(world, monkeypatch):
    db, proj = world

    async def no_dispatch(*_a, **_k):
        return 0

    monkeypatch.setattr("app.services.outbox_inline_dispatch.dispatch_best_effort", no_dispatch)
    args = dict(project_id=proj.id, lead_id="lead-1", actor_id="nr-cust", created=True)
    assert await lifecycle.notify_lead_converted(db, **args) == 1
    assert await lifecycle.notify_lead_converted(db, **args) == 0
    assert await lifecycle.notify_lead_converted(db, **{**args, "created": False}) == 0


@pytest.mark.asyncio
async def test_unpaid_invoice_reminder_cadence_and_cap(world):
    db, proj = world
    now = utc_now()
    db.add(Payment(id="nr-pay", project_id=proj.id, payment_type=PaymentType.stage, status=PaymentStatus.pending,
                   title="Счёт", amount=1000, created_by="nr-lead", created_at=now - timedelta(days=4)))
    await db.commit()
    project = await db.get(Project, proj.id)

    async def scan(at):
        actions = await lifecycle.scan_unpaid_invoice_reminders(db, project, now=at)
        await db.commit()
        return actions

    assert len(await scan(now)) == 1                       # 1-е напоминание
    assert await scan(now) == []                           # повтор прохода воркера — ничего
    assert await scan(now + timedelta(days=2)) == []       # раньше 3 дней — нет
    # строки outbox создаются «сейчас», поэтому сдвигаем их назад, имитируя ход времени
    async def age_reminders(days):
        for row in (await db.execute(select(DomainOutbox))).scalars().all():
            row.created_at = row.created_at - timedelta(days=days, hours=1)
        await db.commit()

    await age_reminders(3)
    assert len(await scan(now)) == 1                       # 2-е
    await age_reminders(3)
    assert len(await scan(now)) == 1                       # 3-е
    await age_reminders(3)
    assert await scan(now) == []                           # больше трёх — никогда
    assert await _outbox_count(db) == 3

    # свежий счёт (моложе 3 дней) и оплаченный — без напоминаний
    db.add(Payment(id="nr-pay2", project_id=proj.id, payment_type=PaymentType.stage, status=PaymentStatus.pending,
                   title="Новый", amount=5, created_by="nr-lead", created_at=now))
    await db.commit()
    assert await scan(now) == []
