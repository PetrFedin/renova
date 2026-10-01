"""JRN-020: исполнитель отвечает на спор; JRN-031: реквизиты исполнителя приватны."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    ContractorProfile, DomainOutbox, Payment, PaymentEvent, PaymentStatus, PaymentType,
    Project, ProjectViewer, User, UserRole,
)
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
    cust = User(id="dr-cust", phone="+79990010001", role=UserRole.customer)
    lead = User(id="dr-lead", phone="+79990010002", role=UserRole.contractor)
    foreman = User(id="dr-fore", phone="+79990010003", role=UserRole.contractor)
    guest = User(id="dr-guest", phone="+79990010004", role=UserRole.customer)
    other = User(id="dr-other", phone="+79990010005", role=UserRole.contractor)
    project = Project(id="dr-proj", name="Кв", renovation_type="cosmetic",
                      customer_id=cust.id, contractor_id=lead.id)
    db.add_all([cust, lead, foreman, guest, other, project])
    await db.flush()
    db.add(ContractorProfile(user_id=lead.id, company_name="ИП Подрядов",
                             payment_requisites="р/с 40802810000000000001, БИК 044525225, ИНН 7700000000"))
    db.add(ProjectViewer(project_id=project.id, user_id=guest.id))
    db.add(Payment(id="dr-pay", project_id=project.id, payment_type=PaymentType.stage,
                   status=PaymentStatus.paid_unverified, title="Этап 1", amount=5000, created_by=cust.id,
                   payment_method="bank_transfer"))
    await db.commit()
    team = (await team_svc.create_or_get_team(db, lead.id, "Бригада")).team
    await team_svc.ensure_team_membership(db, team_id=team.id, user_id=foreman.id, role="foreman")
    await db.commit()
    return cust, lead, foreman, guest, other


async def _open_dispute(db, cust):
    r = await _call(db, cust, "POST", "/api/v1/projects/dr-proj/payments/dr-pay/dispute",
                    json={"reason": "Оплатил, а акт не подписан по факту"})
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_contractor_answers_dispute_and_customer_is_notified(db):
    cust, lead, foreman, guest, other = await _seed(db)
    await _open_dispute(db, cust)
    url = "/api/v1/projects/dr-proj/payments/dr-pay/dispute/respond"
    body = {"response": "agree", "comment": "Согласен вернуть сумму за этап"}
    r = await _call(db, lead, "POST", url, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["changed"] is True and r.json()["payment"]["status"] == "disputed"
    listing = await _call(db, cust, "GET", "/api/v1/projects/dr-proj/payments")
    events = next(p for p in listing.json() if p["id"] == "dr-pay")["events"]
    assert any(e["evidence_type"] == "contractor_dispute_agree" and e["note"] == body["comment"] for e in events)
    assert any(e["evidence_type"] == "customer_dispute" for e in events)  # прежнее не сломано

    again = await _call(db, lead, "POST", url, json=body)
    assert again.status_code == 200 and again.json()["replayed"] is True
    rows = (await db.scalars(select(PaymentEvent).where(
        PaymentEvent.evidence_type == "contractor_dispute_agree"))).all()
    assert len(rows) == 1
    notes = [o for o in (await db.scalars(select(DomainOutbox))).all()
             if '"user_id": "dr-cust"' in o.payload_json and "Исполнитель согласен" in o.payload_json]
    assert len(notes) == 1

    # заказчик по-прежнему закрывает спор сам
    r = await _call(db, cust, "POST", "/api/v1/projects/dr-proj/payments/dr-pay/dispute/resolve",
                    json={"note": "Вопрос урегулирован, спор отзываю"})
    assert r.status_code == 200 and r.json()["payment"]["status"] == "paid_unverified"
    # после закрытия отвечать уже не на что
    late = await _call(db, lead, "POST", url, json=body)
    assert late.status_code == 409 and late.json()["detail"]["code"] == "payment_dispute_not_open"


@pytest.mark.asyncio
async def test_dispute_response_acl_and_validation(db):
    cust, lead, foreman, guest, other = await _seed(db)
    url = "/api/v1/projects/dr-proj/payments/dr-pay/dispute/respond"
    ok_body = {"response": "comment", "comment": "Работы выполнены в полном объёме"}
    # спора нет
    assert (await _call(db, lead, "POST", url, json=ok_body)).status_code == 409
    await _open_dispute(db, cust)
    for actor in (cust, foreman, guest, other):
        r = await _call(db, actor, "POST", url, json=ok_body)
        assert r.status_code in (403, 404), (actor.id, r.status_code)
    assert (await _call(db, lead, "POST", url, json={"response": "bogus", "comment": ok_body["comment"]})).status_code == 422
    assert (await _call(db, lead, "POST", url, json={"response": "comment", "comment": "коротко"})).status_code == 422


@pytest.mark.asyncio
async def test_payment_requisites_visible_only_to_customer_and_lead(db):
    cust, lead, foreman, guest, other = await _seed(db)
    url = "/api/v1/projects/dr-proj/payment-requisites"
    for actor in (cust, lead):
        r = await _call(db, actor, "GET", url)
        assert r.status_code == 200 and "40802810000000000001" in r.json()["payment_requisites"]
        assert r.json()["phone"]
    for actor in (guest, foreman):
        r = await _call(db, actor, "GET", url)
        assert r.status_code == 200, (actor.id, r.text)
        assert r.json()["payment_requisites"] is None and r.json()["phone"] is None
    assert (await _call(db, other, "GET", url)).status_code == 403
    snap = await _call(db, guest, "GET", "/api/v1/portal/projects/dr-proj/snapshot")
    if snap.status_code == 200:
        assert snap.json()["contractor_payment_requisites"] is None
