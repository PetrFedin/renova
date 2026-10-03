"""Живой аудит 3, «Открыто»: BUD-19 (чек без ФНС), MNY-003 (кто внёс расход), разряды, даты в чате."""
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.core.legacy_text import localize_due_dates
from app.db.session import get_db
from app.main import app
from app.models.entities import Payment, PaymentStatus, PaymentType, Project, Receipt, Stage, User, UserRole

PID = "pr-a3o"


async def _seed(db):
    customer = User(id="cu-a3o", phone="+79990022001", role=UserRole.customer, full_name="Заказчик Тест")
    contractor = User(id="ct-a3o", phone="+79990022002", role=UserRole.contractor, full_name="Подрядчик Тест")
    project = Project(
        id=PID, name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id, budget_planned=100000, budget_spent=0,
    )
    stage = Stage(id="st-a3o", project_id=PID, name="Стены", status="done",
                  customer_accepted_at=datetime.utcnow(), payment_amount=5000)
    db.add_all([customer, contractor, project, stage])
    await db.commit()
    return customer, contractor, project, stage


async def _call(db, actor, method, url, json=None):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, url, json=json)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_payment_confirmed_by_unchecked_receipt_is_flagged_but_still_confirmed(db):
    customer, contractor, project, stage = await _seed(db)
    pay = Payment(project_id=PID, stage_id=stage.id, payment_type=PaymentType.stage,
                  status=PaymentStatus.pending, title="Счёт", amount=5000, created_by=contractor.id)
    db.add(pay)
    await db.commit()
    pay_id = pay.id

    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/receipts/manual",
                    {"payment_id": pay_id, "amount": 5000, "description": "чек руками"})
    assert r.status_code == 200, r.text
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/confirm", {})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"  # сценарий оплаты не менялся
    assert r.json()["receipt_unverified"] is True

    for actor in (customer, contractor):
        rows = (await _call(db, actor, "GET", f"/api/v1/projects/{PID}/payments")).json()
        assert [p for p in rows if p["id"] == pay_id][0]["receipt_unverified"] is True

    # проверка ФНС снимает пометку
    rec = (await db.execute(Receipt.__table__.select().where(Receipt.payment_id == pay_id))).first()
    from sqlalchemy import update
    await db.execute(update(Receipt).where(Receipt.id == rec.id).values(fns_verified=True))
    await db.commit()
    rows = (await _call(db, customer, "GET", f"/api/v1/projects/{PID}/payments")).json()
    assert [p for p in rows if p["id"] == pay_id][0]["receipt_unverified"] is False


@pytest.mark.asyncio
async def test_manual_expense_shows_who_entered_it(db):
    customer, contractor, project, stage = await _seed(db)
    r = await _call(db, contractor, "POST", f"/api/v1/projects/{PID}/receipts/manual",
                    {"amount": 1500, "description": "Краска подрядчика"})
    assert r.status_code == 200, r.text
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/receipts/manual",
                    {"amount": 700, "description": "Клей заказчика"})
    assert r.status_code == 200, r.text

    rows = (await _call(db, customer, "GET", f"/api/v1/projects/{PID}/os/expenses")).json()
    by_title = {row["title"]: row for row in rows}
    # сам расход остаётся сразу подтверждённым
    assert by_title["Краска подрядчика"]["status"] == "confirmed"
    assert by_title["Краска подрядчика"]["entered_by_role"] == "contractor"
    assert by_title["Краска подрядчика"]["entered_by_name"] == "Подрядчик Тест"
    assert by_title["Клей заказчика"]["entered_by_role"] == "customer"

    receipts = (await _call(db, customer, "GET", f"/api/v1/projects/{PID}/receipts")).json()
    by_desc = {x["description"]: x for x in receipts}
    assert by_desc["Краска подрядчика"]["entered_by_role"] == "contractor"
    assert by_desc["Клей заказчика"]["entered_by_role"] == "customer"


@pytest.mark.asyncio
async def test_receipt_expense_title_has_digit_grouping(db):
    customer, contractor, project, stage = await _seed(db)
    from app.services import budget_service as budget

    rec = Receipt(project_id=PID, amount=1500, fn="1", fns_verified=False, qr_raw="qr")
    db.add(rec)
    await db.flush()
    expense = await budget.expense_from_receipt(db, rec)
    assert expense.title == "Чек 1 500 ₽"


def test_legacy_chat_due_date_is_localized():
    assert localize_due_dates("📋 Задача: Покраска · до 2026-10-05") == "📋 Задача: Покраска · до 05.10.2026"
    assert localize_due_dates("до 2026-10-05T10:00:00") == "до 05.10.2026"
    assert localize_due_dates("Сдать до 05.10.2026") == "Сдать до 05.10.2026"
    assert localize_due_dates(None) is None
