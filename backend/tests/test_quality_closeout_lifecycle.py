"""QLT-002/003/004/005/008, JRN-027: замечания, приёмка, closeout, гарантия, запирание проекта.

- открытые critical/high по этапу блокируют приёмку этапа, любые открытые critical/high — closeout;
  low/medium — только предупреждение (один источник истины: issue_service.open_issues_gate);
- в проекте без исполнителя заказчик закрывает замечание сам, с исполнителем схема сохраняется;
- технадзор ведёт замечания (fixed -> closed / open), но не исполняет;
- severity и координаты валидируются (422);
- гарантия: ответ исполнителя, повторное открытие, уведомления, идемпотентное закрытие;
- после closeout смета/график/счета/этапы заперты (409 project_closed), гарантия и чтение — нет.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.models.technical_supervision  # noqa: F401
from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    AppNotification,
    Project,
    ProjectIssue,
    Stage,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
    WorkAcceptance,
)
from app.services import issue_service as iss
from app.services import storage_service as storage_svc
from app.services import technical_supervision_service as supervision


async def _no_dispatch(*_a, **_k):
    return None


async def _seed(db, *, with_contractor=True):
    customer = User(id="q-cust", phone="+79990008001", role=UserRole.customer, full_name="Заказчик")
    contractor = User(id="q-contr", phone="+79990008002", role=UserRole.contractor, full_name="Исполнитель")
    sup = User(id="q-sup", phone="+79990008003", role=UserRole.contractor, profile_code="QSUP01")
    db.add_all([customer, contractor, sup])
    project = Project(
        id="q-project", name="Объект", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id if with_contractor else None,
        budget_planned=1, budget_spent=0,
    )
    db.add(project)
    await db.commit()
    return customer, contractor, sup, project


async def _call(db, actor, method, path, json=None):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, f"/api/v1{path}", json=json)
    finally:
        app.dependency_overrides.clear()


async def _issue(db, project, *, severity="medium", status="open", stage_id=None, title="Трещина"):
    row = ProjectIssue(project_id=project.id, title=title, severity=severity, status=status, stage_id=stage_id)
    db.add(row)
    await db.commit()
    return row


# ------------------------------------------------------------------ валидация

@pytest.mark.asyncio
async def test_issue_create_validates_severity_and_coordinates(db):
    customer, _, _, project = await _seed(db)
    base = {"title": "Скол"}
    for bad in ({"severity": "urgent"}, {"x_pct": 101}, {"y_pct": -1}):
        r = await _call(db, customer, "POST", f"/projects/{project.id}/issues", {**base, **bad})
        assert r.status_code == 422, (bad, r.text)
    r = await _call(db, customer, "POST", f"/projects/{project.id}/issues", {**base, "severity": "high", "x_pct": 0, "y_pct": 100})
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ QLT-003 / QLT-005

@pytest.mark.asyncio
async def test_self_managed_customer_closes_issue_directly(db):
    customer, _, _, project = await _seed(db, with_contractor=False)
    issue = await _issue(db, project)
    r = await _call(db, customer, "POST", f"/projects/{project.id}/issues/{issue.id}/transition", {"status": "closed"})
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["closed_at"]
    # legacy /close тоже закрывает
    other = await _issue(db, project, title="Вторая")
    r = await _call(db, customer, "POST", f"/projects/{project.id}/issues/{other.id}/close")
    assert r.status_code == 200 and r.json()["status"] == "closed"


@pytest.mark.asyncio
async def test_with_contractor_scheme_is_kept_and_legacy_close_explains(db):
    customer, contractor, _, project = await _seed(db)
    issue = await _issue(db, project)
    path = f"/projects/{project.id}/issues/{issue.id}"
    r = await _call(db, customer, "POST", f"{path}/transition", {"status": "closed"})
    assert r.status_code == 409  # open -> closed нет в графе
    r = await _call(db, customer, "POST", f"{path}/transition", {"status": "fixed"})
    assert r.status_code == 403  # исправляет исполнитель
    # QLT-005: заказчик /close на open — 409 с кодом, а не «пустой» 404
    r = await _call(db, customer, "POST", f"{path}/close")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "invalid_issue_transition"
    r = await _call(db, contractor, "POST", f"{path}/transition", {"status": "fixed"})
    assert r.status_code == 200
    r = await _call(db, contractor, "POST", f"{path}/close")  # повтор на fixed
    assert r.status_code == 409
    r = await _call(db, customer, "POST", f"{path}/transition", {"status": "closed"})
    assert r.status_code == 200


# ------------------------------------------------------------------ QLT-008 технадзор

@pytest.mark.asyncio
async def test_supervisor_verifies_and_closes_but_does_not_execute(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer, contractor, sup, project = await _seed(db)
    await supervision.appoint_or_replace(
        db, project_id=project.id, actor=customer, profile_code="QSUP01", provider_type="individual", provider_name=None,
    )
    issue = await _issue(db, project, status="fixed")
    path = f"/projects/{project.id}/issues/{issue.id}/transition"
    r = await _call(db, sup, "POST", path, {"status": "open"})
    assert r.status_code == 200 and r.json()["status"] == "open"
    # исполнительный переход технадзору недоступен
    r = await _call(db, sup, "POST", path, {"status": "fixed"})
    assert r.status_code == 403
    issue.status = "fixed"
    await db.commit()
    r = await _call(db, sup, "POST", path, {"status": "closed"})
    assert r.status_code == 200 and r.json()["status"] == "closed"
    # исполнитель и заказчик получили уведомления о закрытии
    notified = {n.user_id for n in (await db.execute(select(AppNotification))).scalars().all()}
    assert {customer.id, contractor.id} <= notified or contractor.id in notified


@pytest.mark.asyncio
async def test_stranger_still_forbidden_on_transition(db):
    _, _, _, project = await _seed(db)
    stranger = User(id="q-str", phone="+79990008009", role=UserRole.contractor)
    db.add(stranger)
    issue = await _issue(db, project, status="fixed")
    await db.commit()
    r = await _call(db, stranger, "POST", f"/projects/{project.id}/issues/{issue.id}/transition", {"status": "closed"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_supervisor_name_never_falls_back_to_phone(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer, _, sup, project = await _seed(db)
    result = await supervision.appoint_or_replace(
        db, project_id=project.id, actor=customer, profile_code="QSUP01", provider_type="individual", provider_name=None,
    )
    assert result.assignment.provider_name == "Технадзор"
    assert sup.phone not in result.assignment.provider_name


# ------------------------------------------------------------------ QLT-002

@pytest.mark.asyncio
async def test_gate_blocks_critical_high_and_only_warns_on_low_medium(db):
    _, _, _, project = await _seed(db)
    stage = Stage(id="q-st", project_id=project.id, name="Стены", status=StageStatus.review)
    db.add(stage)
    await db.commit()
    await _issue(db, project, severity="medium", stage_id=stage.id)
    await _issue(db, project, severity="low")
    gate = await iss.open_issues_gate(db, project.id, stage_id=stage.id)
    assert gate["blocking_count"] == 0 and gate["warning_count"] == 1
    await _issue(db, project, severity="critical", stage_id=stage.id, title="Течь")
    gate = await iss.open_issues_gate(db, project.id, stage_id=stage.id)
    assert gate["blocking_count"] == 1 and gate["blocking"][0]["title"] == "Течь"
    # закрытые и гарантийные не считаются
    await _issue(db, project, severity="high", status="closed", stage_id=stage.id)
    await _issue(db, project, severity="high", title="[Гарантия] Щель")
    assert (await iss.open_issues_gate(db, project.id))["blocking_count"] == 1


@pytest.mark.asyncio
async def test_stage_acceptance_blocked_by_open_critical_and_closeout_too(db):
    customer, _, _, project = await _seed(db)
    pid = project.id
    stage = Stage(id="q-acc", project_id=project.id, name="Стены", status=StageStatus.review, contractor_ready=True,
                  checklist_json='[{"id": "c1", "text": "Готово", "done": true}]')
    db.add(stage)
    db.add(StagePhoto(stage_id=stage.id, user_id=customer.id, caption="Результат", image_data="x"))
    acc = WorkAcceptance(id="q-wa", project_id=project.id, stage_id=stage.id, status="requested")
    db.add(acc)
    issue = await _issue(db, project, severity="critical", stage_id=stage.id)
    issue_id = issue.id
    stage_id = stage.id
    await _issue(db, project, severity="medium", stage_id=stage.id, title="Мелочь")
    await db.commit()

    r = await _call(db, customer, "POST", f"/projects/{pid}/work-acceptances/q-wa/accept", {})
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "open_issues_block_acceptance"
    assert [i["id"] for i in detail["issues"]] == [issue_id] and detail["warning_count"] == 1
    await db.refresh(customer)  # общая тестовая сессия: rollback в роуте протушил объекты
    assert (await db.get(Stage, stage_id)).status == StageStatus.review

    resp = await _call(db, customer, "GET", f"/projects/{pid}/closeout-checklist")
    assert resp.status_code == 200, resp.text
    snap = resp.json()
    assert snap["ready"] is False and snap["open_issues_blocking"] == 1 and snap["open_issues_warning"] == 1
    r = await _call(db, customer, "POST", f"/projects/{pid}/closeout")
    assert r.status_code == 409
    await db.refresh(customer)

    # исправили и закрыли — приёмка проходит; medium не мешает
    issue.status = "closed"
    await db.commit()
    r = await _call(db, customer, "POST", f"/projects/{pid}/work-acceptances/q-wa/accept", {})
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ JRN-027

@pytest.mark.asyncio
async def test_closed_project_is_locked_but_warranty_and_reads_work(db):
    customer, contractor, _, project = await _seed(db)
    project.is_archived = True
    await db.commit()
    pid = project.id
    for who, method, path, body in (
        (contractor, "POST", f"/projects/{project.id}/payments", {"title": "x", "payment_type": "material", "amount": 1}),
        (contractor, "POST", f"/projects/{project.id}/change-orders", {"title": "x", "amount": 1}),
        (customer, "POST", f"/projects/{project.id}/stages", {"name": "Ещё этап"}),
    ):
        r = await _call(db, who, method, path, body)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "project_closed", (path, r.status_code, r.text[:200])
    assert (await _call(db, customer, "GET", f"/projects/{project.id}/payments")).status_code == 200
    assert (await _call(db, customer, "GET", f"/projects/{project.id}")).status_code == 200
    r = await _call(db, customer, "POST", f"/projects/{project.id}/warranty-claims",
                    {"title": "Трещина", "description": "Через месяц", "client_request_id": "q-warr-0001"})
    assert r.status_code == 200 and r.json()["post_closeout"] is True


# ------------------------------------------------------------------ QLT-004 гарантия

async def _claim(db, customer, project):
    r = await _call(db, customer, "POST", f"/projects/{project.id}/warranty-claims",
                    {"title": "Трещина в ламинате", "description": "Через 2 недели", "client_request_id": "q-warr-0002"})
    assert r.status_code == 200, r.text
    return r.json()["issue_id"]


async def _notes(db, user_id):
    rows = (await db.execute(select(AppNotification).where(AppNotification.user_id == user_id))).scalars().all()
    return [(n.title, n.link_path) for n in rows]


@pytest.mark.asyncio
async def test_warranty_response_reopen_close_and_notifications(db):
    customer, contractor, _, project = await _seed(db)
    cid = await _claim(db, customer, project)
    base = f"/projects/{project.id}/warranty-claims/{cid}"

    # заказчик отвечать за исполнителя не может, отказ без причины — 422
    assert (await _call(db, customer, "POST", f"{base}/respond", {"decision": "accept"})).status_code == 403
    r = await _call(db, contractor, "POST", f"{base}/respond", {"decision": "reject"})
    assert r.status_code == 422
    r = await _call(db, contractor, "POST", f"{base}/respond", {"decision": "reject", "comment": "Не гарантийный случай"})
    assert r.status_code == 200 and r.json()["issue"]["status"] == "rejected"
    assert "Не гарантийный случай" in r.json()["issue"]["description"]
    titles = await _notes(db, customer.id)
    assert any("отклонил" in t and link.startswith("/documents") for t, link in titles)

    # заказчик не согласен — открывает снова; исполнитель принимает и отмечает исправленным
    assert (await _call(db, contractor, "POST", f"{base}/reopen", {})).status_code == 403
    r = await _call(db, customer, "POST", f"{base}/reopen", {"comment": "Трещина растёт"})
    assert r.status_code == 200 and r.json()["issue"]["status"] == "open"
    r = await _call(db, contractor, "POST", f"{base}/respond", {"decision": "accept", "comment": "Приедем в пятницу"})
    assert r.json()["issue"]["status"] == "in_progress"
    # Без evidence статус fixed не меняется.
    r = await _call(db, contractor, "POST", f"{base}/respond", {"decision": "fixed"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "warranty_evidence_required"

    evidence_key = f"project-media/{project.id}/warranty-resolution.jpg"
    await storage_svc.write_bytes_at_key(evidence_key, b"warranty-resolution", content_type="image/jpeg")
    r = await _call(
        db,
        contractor,
        "POST",
        f"{base}/respond",
        {"decision": "fixed", "evidence_photo_key": evidence_key},
    )
    assert r.status_code == 200 and r.json()["issue"]["status"] == "fixed"
    assert r.json()["issue"]["photo_key"] == evidence_key

    # закрытие: только после fixed + evidence; уведомление исполнителю, повтор идемпотентен
    r = await _call(db, customer, "POST", f"{base}/close")
    assert r.status_code == 200 and r.json()["changed"] is True
    closed_at = r.json()["issue"]["closed_at"]
    before = len(await _notes(db, contractor.id))
    r = await _call(db, customer, "POST", f"{base}/close")
    assert r.status_code == 200 and r.json()["changed"] is False and r.json()["issue"]["closed_at"] == closed_at
    after = await _notes(db, contractor.id)
    assert len(after) == before
    assert any("закрыто" in t and link.startswith("/quality-control") for t, link in after)

    # и после закрытия заказчик может открыть обращение снова
    r = await _call(db, customer, "POST", f"{base}/reopen", {})
    assert r.status_code == 200 and r.json()["issue"]["status"] == "open" and r.json()["issue"]["closed_at"] is None


@pytest.mark.asyncio
async def test_warranty_respond_rejects_invalid_state(db):
    customer, contractor, _, project = await _seed(db)
    cid = await _claim(db, customer, project)
    base = f"/projects/{project.id}/warranty-claims/{cid}"
    rejected = await _call(
        db,
        contractor,
        "POST",
        f"{base}/respond",
        {"decision": "reject", "comment": "Не гарантийный случай"},
    )
    assert rejected.status_code == 200
    closed = await _call(db, customer, "POST", f"{base}/close")
    assert closed.status_code == 200
    r = await _call(db, contractor, "POST", f"{base}/respond", {"decision": "accept"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "warranty_claim_state_invalid"
    # обычный issue не принимается за гарантию
    plain = await _issue(db, project)
    r = await _call(db, contractor, "POST", f"/projects/{project.id}/warranty-claims/{plain.id}/respond", {"decision": "accept"})
    assert r.status_code == 400
