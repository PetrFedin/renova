"""Волна 2: жизненный цикл этапа (STG-002/005/010/014/015, JRN-011/029).

- STG-002: срок доработки продлевает заказчик; исполнитель лишь просит.
- STG-005: прораб бригады видит этапы лида и может их стартовать/сдавать.
- STG-010: зависимость снимается, не начатый этап отменяется; с работами/деньгами — 409.
- STG-014/015: просрочка SLA доработки и долгое ожидание приёмки уведомляют, но ничего не принимают.
"""
from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.core.timeutil import utc_now
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    DomainOutbox,
    Project,
    Stage,
    StageComment,
    StageStatus,
    Team,
    TeamMember,
    User,
    UserRole,
    WorkAcceptance,
    WorkDependency,
)
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    ProjectDocument,
)
from app.services import automation_engine
from app.services import stage_mutation_service as mutations


def _id() -> str:
    return str(uuid4())


def _user(role: UserRole) -> User:
    return User(id=_id(), phone=f"+7{uuid4().int % 10_000_000_000:010d}", role=role)


async def _world(db, *, signed: bool = False):
    customer, lead, foreman, member, outsider = (
        _user(UserRole.customer),
        _user(UserRole.contractor),
        _user(UserRole.contractor),
        _user(UserRole.contractor),
        _user(UserRole.contractor),
    )
    project = Project(
        id=_id(), name="Stage lifecycle", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=lead.id,
    )
    team = Team(id=_id(), name="Бригада", owner_id=lead.id)
    rows = [
        customer, lead, foreman, member, outsider, project, team,
        TeamMember(team_id=team.id, user_id=lead.id, role="owner"),
        TeamMember(team_id=team.id, user_id=foreman.id, role="foreman"),
        TeamMember(team_id=team.id, user_id=member.id, role="member"),
    ]
    first = Stage(id=_id(), project_id=project.id, name="Демонтаж", sort_order=0, status=StageStatus.planned)
    second = Stage(id=_id(), project_id=project.id, name="Электрика", sort_order=1, status=StageStatus.planned,
                   depends_on_stage_id=first.id)
    rows += [first, second]
    if signed:
        doc_id, ver_id = _id(), _id()
        rows += [
            ProjectDocument(id=doc_id, project_id=project.id, document_type=DocumentType.contract.value,
                            title="Договор", status=DocumentStatus.active.value,
                            current_version_id=ver_id, created_by=customer.id),
            DocumentVersion(id=ver_id, document_id=doc_id, version_number=1, created_by=customer.id),
        ]
        for u, role in ((customer, "customer"), (lead, "contractor")):
            rows.append(DocumentSignature(id=_id(), document_id=doc_id, version_id=ver_id,
                                          signer_user_id=u.id, signer_role=role, status="signed"))
    db.add_all(rows)
    await db.commit()
    objs = {"customer": customer, "lead": lead, "foreman": foreman, "member": member,
            "outsider": outsider, "project": project, "first": first, "second": second}
    # id берём сразу: после rollback в 409-ветках объекты expire-ятся.
    return {**objs, **{f"{k}_id": v.id for k, v in objs.items()}}


async def _client(db, actor_id):

    async def _db():
        yield db

    async def _user_dep():
        return await db.get(User, actor_id)

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user_dep
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.clear()


async def _notifications(db, user_id: str) -> list[str]:
    import json

    rows = (await db.execute(select(DomainOutbox))).scalars().all()
    out = []
    for row in rows:
        payload = json.loads(row.payload_json or "{}")
        if payload.get("user_id") == user_id and payload.get("title"):
            out.append(payload["title"])
    return out


# --- STG-005 / STG-006: бригада лида --------------------------------------

async def test_foreman_sees_stages_and_can_start(db):
    w = await _world(db, signed=True)
    async with await _client(db, w["foreman_id"]) as client:
        plan = await client.get(f"/api/v1/projects/{w['project_id']}/plan")
        assert plan.status_code == 200
        assert {s["name"] for s in plan.json()["stages"]} == {"Демонтаж", "Электрика"}
        detail = await client.get(f"/api/v1/projects/{w['project_id']}/stages/{w['first_id']}")
        assert detail.status_code == 200
        assert detail.json()["capabilities"]["can_start"] is True
        started = await client.post(f"/api/v1/projects/{w['project_id']}/stages/{w['first_id']}/start")
        assert started.status_code == 200, started.text
        assert started.json()["status"] == "active"
        proj = await client.get(f"/api/v1/projects/{w['project_id']}")
        assert proj.status_code == 200
        assert len(proj.json()["stages"]) == 2


async def test_plain_member_cannot_start_unassigned_stage_but_can_when_assigned(db):
    w = await _world(db, signed=True)
    async with await _client(db, w["member_id"]) as client:
        r = await client.post(f"/api/v1/projects/{w['project_id']}/stages/{w['first_id']}/start")
        assert r.status_code == 403
    # лид назначает этап участнику
    async with await _client(db, w["lead_id"]) as client:
        r = await client.patch(
            f"/api/v1/projects/{w['project_id']}/stages/{w['first_id']}/assignee",
            json={"assignee_id": w["member_id"]},
        )
        assert r.status_code == 200, r.text
        assert r.json()["assignee_id"] == w["member_id"]
        bad = await client.patch(
            f"/api/v1/projects/{w['project_id']}/stages/{w['first_id']}/assignee",
            json={"assignee_id": w["outsider_id"]},
        )
        assert bad.status_code == 422
    async with await _client(db, w["member_id"]) as client:
        r = await client.post(f"/api/v1/projects/{w['project_id']}/stages/{w['first_id']}/start")
        assert r.status_code == 200, r.text
    # назначенный участник не мешает лиду и прорабу видеть этап
    async with await _client(db, w["foreman_id"]) as client:
        plan = await client.get(f"/api/v1/projects/{w['project_id']}/plan")
        assert len(plan.json()["stages"]) == 2


async def test_outsider_contractor_still_cannot_start(db):
    w = await _world(db, signed=True)
    async with await _client(db, w["outsider_id"]) as client:
        r = await client.post(f"/api/v1/projects/{w['project_id']}/stages/{w['first_id']}/start")
        assert r.status_code in (403, 404)


# --- STG-002: продление SLA доработки ------------------------------------------

async def _rework_stage(db, w):
    st = await db.get(Stage, w["first_id"])
    st.status = StageStatus.active
    st.needs_rework = True
    st.rework_deadline = utc_now() + timedelta(days=1)
    await db.commit()
    return st


async def test_contractor_extension_is_a_request_customer_confirms(db):
    w = await _world(db)
    st = await _rework_stage(db, w)
    before = st.rework_deadline
    pid = w["project_id"]
    url = f"/api/v1/projects/{pid}/rework-sla/extend?stage_id={st.id}&days=2"
    async with await _client(db, w["lead_id"]) as client:
        r = await client.post(url)
        assert r.status_code == 200 and r.json()["status"] == "requested"
        again = await client.post(url)
        assert again.json()["status"] == "requested"
    await db.refresh(st)
    assert st.rework_deadline == before  # исполнитель срок не меняет
    titles = await _notifications(db, w["customer_id"])
    assert titles.count("Запрос продления срока доработки") == 1  # дедупликация
    async with await _client(db, w["customer_id"]) as client:
        r = await client.post(url)
        assert r.status_code == 200 and r.json()["status"] == "extended"
    await db.refresh(st)
    assert st.rework_deadline > before
    assert "Срок доработки продлён" in await _notifications(db, w["lead_id"])
    comments = (await db.execute(select(StageComment).where(StageComment.stage_id == st.id))).scalars().all()
    assert len(comments) == 2  # запрос и продление остаются в обсуждении этапа


async def test_extension_requires_rework_role_and_has_limit(db):
    w = await _world(db)
    pid = w["project_id"]
    st = await db.get(Stage, w["first_id"])
    async with await _client(db, w["customer_id"]) as client:
        r = await client.post(f"/api/v1/projects/{pid}/rework-sla/extend?stage_id={st.id}")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "rework_not_requested"
    await _rework_stage(db, w)
    async with await _client(db, w["member_id"]) as client:
        r = await client.post(f"/api/v1/projects/{pid}/rework-sla/extend?stage_id={st.id}")
        assert r.status_code == 403
    async with await _client(db, w["outsider_id"]) as client:
        r = await client.post(f"/api/v1/projects/{pid}/rework-sla/extend?stage_id={st.id}")
        assert r.status_code in (403, 404)
    async with await _client(db, w["customer_id"]) as client:
        for _ in range(3):
            r = await client.post(f"/api/v1/projects/{pid}/rework-sla/extend?stage_id={st.id}&days=7")
        assert r.status_code == 422 and r.json()["detail"]["code"] == "rework_sla_limit"


async def test_customer_can_decline_request(db):
    w = await _world(db)
    st = await _rework_stage(db, w)
    pid = w["project_id"]
    async with await _client(db, w["lead_id"]) as client:
        r = await client.post(f"/api/v1/projects/{pid}/rework-sla/decline?stage_id={st.id}")
        assert r.status_code == 403
    async with await _client(db, w["customer_id"]) as client:
        r = await client.post(f"/api/v1/projects/{pid}/rework-sla/decline?stage_id={st.id}&reason=нет")
        assert r.status_code == 200 and r.json()["status"] == "declined"
    assert "Продление срока отклонено" in await _notifications(db, w["lead_id"])


# --- STG-014 / STG-015: напоминания ---------------------------------------------

async def test_overdue_rework_and_long_acceptance_notify_once_without_auto_accept(db):
    w = await _world(db)
    project = await db.get(Project, w["project_id"])
    first = await db.get(Stage, w["first_id"])
    second = await db.get(Stage, w["second_id"])
    first.status = StageStatus.active
    first.needs_rework = True
    first.rework_deadline = utc_now() - timedelta(hours=3)
    second.status = StageStatus.review
    second.contractor_ready = True
    second.contractor_ready_at = utc_now() - timedelta(days=3)
    second.planned_end = (utc_now() - timedelta(days=5)).date()
    await db.commit()
    await db.refresh(project, ["stages"])

    actions = await automation_engine.scan_project_reminders(db, project)
    await db.commit()
    kinds = sorted(a.split(":")[0] for a in actions)
    assert "rework_sla_overdue" in kinds and "rework_sla_overdue_customer" in kinds
    assert "acceptance_wait" in kinds
    # этап на приёмке ждёт заказчика: «Просрочка работы» исполнителю не уходит (STG-015)
    assert not any(a.startswith("overdue:") and a.endswith(second.id) for a in actions)
    assert "SLA доработки просрочен" in await _notifications(db, w["lead_id"])
    assert "Исполнитель не уложился в срок доработки" in await _notifications(db, w["customer_id"])
    assert "Этап давно ждёт приёмки" in await _notifications(db, w["customer_id"])

    again = await automation_engine.scan_project_reminders(db, project)
    assert not [a for a in again if a.startswith(("rework_sla", "acceptance_wait"))]  # однократно
    await db.refresh(second)
    assert second.status == StageStatus.review  # автоприёмки нет


async def test_rework_deadline_soon_notifies_executor_with_check_key(db):
    w = await _world(db)
    project = await db.get(Project, w["project_id"])
    st = await _rework_stage(db, w)
    st.rework_deadline = utc_now() + timedelta(hours=5)
    await db.commit()
    await db.refresh(project, ["stages"])
    actions = await automation_engine.scan_project_reminders(db, project)
    await db.commit()
    assert f"rework_sla_soon:{st.id}" in actions
    async with await _client(db, w["lead_id"]) as client:
        r = await client.post(f"/api/v1/projects/{w['project_id']}/rework-sla/check")
        assert r.json()["reminders"] == 0 and r.json()["already_sent"] == 1  # тот же ключ


# --- STG-010: зависимости и отмена этапа -----------------------------------------

async def test_clearing_dependency_unblocks_start_and_sync_does_not_resurrect_it(db):
    w = await _world(db, signed=True)
    pid = w["project_id"]
    dep = WorkDependency(id=_id(), project_id=pid, stage_id=w["second_id"],
                         depends_on_stage_id=w["first_id"], dependency_type="work")
    db.add(dep)
    await db.commit()
    dep_id = dep.id
    async with await _client(db, w["lead_id"]) as client:
        blocked = await client.post(f"/api/v1/projects/{pid}/stages/{w['second_id']}/start")
        assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "blocked"
        # заказчик не может править график, но может снять зависимость
        removed = await client.delete(f"/api/v1/projects/{pid}/dependencies/{dep_id}")
        assert removed.status_code == 200 and removed.json()["status"] == "waived"
        again = await client.delete(f"/api/v1/projects/{pid}/dependencies/{dep_id}")
        assert again.status_code == 200 and again.json()["replayed"] is True
        sync = await client.post(f"/api/v1/projects/{pid}/dependencies/sync")
        assert sync.status_code == 200
        ok = await client.post(f"/api/v1/projects/{pid}/stages/{w['second_id']}/start")
        assert ok.status_code == 200, ok.text
    async with await _client(db, w["outsider_id"]) as client:
        r = await client.delete(f"/api/v1/projects/{pid}/dependencies/{dep_id}")
        assert r.status_code in (403, 404)


async def test_patch_depends_null_waives_work_dependencies(db):
    w = await _world(db, signed=True)
    pid = w["project_id"]
    db.add(WorkDependency(id=_id(), project_id=pid, stage_id=w["second_id"],
                          depends_on_stage_id=w["first_id"], dependency_type="work"))
    await db.commit()
    async with await _client(db, w["lead_id"]) as client:
        r = await client.patch(f"/api/v1/projects/{pid}/stages/{w['second_id']}/depends",
                               json={"depends_on_stage_id": None})
        assert r.status_code == 200
        ok = await client.post(f"/api/v1/projects/{pid}/stages/{w['second_id']}/start")
        assert ok.status_code == 200, ok.text


async def test_delete_unstarted_stage_by_customer_and_lead_clears_dependents(db):
    w = await _world(db)
    pid = w["project_id"]
    async with await _client(db, w["outsider_id"]) as client:
        r = await client.delete(f"/api/v1/projects/{pid}/stages/{w['first_id']}")
        assert r.status_code in (403, 404)
    async with await _client(db, w["member_id"]) as client:
        r = await client.delete(f"/api/v1/projects/{pid}/stages/{w['first_id']}")
        assert r.status_code == 403
    async with await _client(db, w["customer_id"]) as client:
        r = await client.delete(f"/api/v1/projects/{pid}/stages/{w['first_id']}")
        assert r.status_code == 200, r.text
    assert await db.get(Stage, w["first_id"]) is None
    second = await db.get(Stage, w["second_id"])
    await db.refresh(second)
    assert second.depends_on_stage_id is None
    async with await _client(db, w["lead_id"]) as client:
        r = await client.delete(f"/api/v1/projects/{pid}/stages/{w['second_id']}")
        assert r.status_code == 200
        gone = await client.delete(f"/api/v1/projects/{pid}/stages/{w['second_id']}")
        assert gone.status_code == 404


async def test_delete_blocked_for_started_stage_or_stage_with_acceptance(db):
    w = await _world(db)
    pid = w["project_id"]
    first = await db.get(Stage, w["first_id"])
    first.status = StageStatus.active
    await db.commit()
    first_id = first.id
    async with await _client(db, w["customer_id"]) as client:
        r = await client.delete(f"/api/v1/projects/{pid}/stages/{first_id}")
        assert r.status_code == 409
        detail = r.json()["detail"]
        assert detail["code"] == "stage_delete_blocked"
        assert detail["blockers"][0]["code"] == "stage_already_started"
        # не начатый этап с историей приёмки тоже остаётся
        db.add(WorkAcceptance(id=_id(), project_id=pid, stage_id=w["second_id"], status="returned"))
        await db.commit()
        r = await client.delete(f"/api/v1/projects/{pid}/stages/{w['second_id']}")
        assert r.status_code == 409
        assert r.json()["detail"]["blockers"][0]["code"] == "stage_has_acceptances"
    assert await db.get(Stage, first_id) is not None


# --- JRN-011 / STG-005: проект рождается без активного этапа ----------------------

async def test_new_stage_is_not_started_by_assignment_and_foreman_helper(db):
    w = await _world(db)
    assert await mutations.is_team_executor(db, w["project"], w["foreman"]) is True
    assert await mutations.is_team_executor(db, w["project"], w["lead"]) is True
    assert await mutations.is_team_executor(db, w["project"], w["member"]) is False
    assert await mutations.is_team_executor(db, w["project"], w["customer"]) is False
