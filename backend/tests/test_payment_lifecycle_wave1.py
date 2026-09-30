"""Волна 1-B: жизненный цикл счёта (MNY-002/006/007/008/009/011/015/022, JRN-006/007/008).

- чек не подтверждает счёт, если не покрывает его сумму или внесён не плательщиком;
- `paid_unverified` имеет выход без админа: чек, «деньги получены / не получены»;
- счёт можно отменить/исправить, пока он `pending`; отмена не блокирует новый счёт;
- Σ активных счетов этапа не превышает сумму этапа;
- подтверждённый платёж этапа попадает в `budget_spent`;
- банковская выписка не превращает поступления в расходы.
"""
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    Payment,
    PaymentEvent,
    PaymentStatus,
    PaymentType,
    Project,
    Stage,
    User,
    UserRole,
)
from app.services.accept_orchestrator import ensure_stage_payment
from app.services.integrations.bank_import import parse_bank_statement, parse_bank_statement_csv


PID, SID = "pr-w1b", "st-w1b"


async def _seed(db, *, stage_amount=10000.0):
    customer = User(id="cu-w1b", phone="+79990011001", role=UserRole.customer)
    contractor = User(id="ct-w1b", phone="+79990011002", role=UserRole.contractor)
    member = User(id="mb-w1b", phone="+79990011003", role=UserRole.contractor)
    project = Project(
        id="pr-w1b", name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=contractor.id,
        budget_planned=100000, budget_spent=0,
    )
    stage = Stage(
        id="st-w1b", project_id=project.id, name="Стены", status="done",
        customer_accepted_at=datetime.utcnow(), payment_amount=stage_amount,
    )
    db.add_all([customer, contractor, member, project, stage])
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


async def _invoice(db, project, stage, amount, status=PaymentStatus.pending, created_by="ct-w1b"):
    pay = Payment(
        project_id=project.id, stage_id=stage.id if stage else None,
        payment_type=PaymentType.stage if stage else PaymentType.material,
        status=status, title="Счёт", amount=amount, created_by=created_by,
    )
    db.add(pay)
    await db.commit()
    return pay


# --- MNY-002 / JRN-007: чек и сумма ------------------------------------

@pytest.mark.asyncio
async def test_one_ruble_receipt_does_not_confirm_5000_invoice(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 5000)
    pay_id = pay.id

    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/receipts/manual",
                    {"payment_id": pay_id, "amount": 1, "description": "чек"})
    assert r.status_code == 200, r.text

    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/confirm", {})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "receipt_amount_below_invoice"
    await db.refresh(pay)
    assert pay.status == PaymentStatus.pending
    await db.refresh(project)
    assert project.budget_spent == 0  # 1 ₽ не попал в факт

    # с отметкой перевода — честное «без проверки», а не confirmed
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/confirm",
                    {"transfer_ack": True})
    assert r.status_code == 200
    assert r.json()["status"] == "paid_unverified"
    await db.refresh(project)
    assert project.budget_spent == 0


@pytest.mark.asyncio
async def test_contractor_cannot_attach_receipt_to_invoice(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 5000)
    pay_id = pay.id
    r = await _call(db, contractor, "POST", f"/api/v1/projects/{PID}/receipts/manual",
                    {"payment_id": pay_id, "amount": 5000, "description": "мой чек"})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "receipt_payment_customer_only"
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/confirm", {})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_covering_receipt_after_paid_unverified_confirms_and_reaches_fact(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 5000)
    pay_id = pay.id
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/confirm",
                    {"transfer_ack": True})
    assert r.json()["status"] == "paid_unverified"

    # раньше здесь был 409 «К счёту уже нельзя прикрепить чек» (MNY-009)
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/receipts/manual",
                    {"payment_id": pay_id, "amount": 4999.5, "description": "чек на перевод"})
    assert r.status_code == 200, r.text
    await db.refresh(pay)
    assert pay.status == PaymentStatus.confirmed
    await db.refresh(project)
    assert project.budget_spent == 5000  # JRN-006/MNY-014: платёж этапа — в факте


@pytest.mark.asyncio
async def test_confirmed_by_unverified_receipt_reaches_fact(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 7000)
    pay_id = pay.id
    qr = "t=20260927T1200&s=7000.00&fn=9999078900001234&i=1&fp=1&n=1"
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/receipts/scan",
                    {"payment_id": pay_id, "qr_raw": qr})
    assert r.status_code == 200, r.text
    await db.refresh(project)
    assert project.budget_spent == 0  # пока счёт не подтверждён — не в факте
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/confirm", {})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"
    await db.refresh(project)
    assert project.budget_spent == 7000


# --- MNY-009 / MNY-015: получатель ------------------------------------

@pytest.mark.asyncio
async def test_recipient_confirms_receipt_of_money(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 5000, status=PaymentStatus.paid_unverified)
    pay_id = pay.id
    url = f"/api/v1/projects/{PID}/payments/{pay_id}/recipient-response"

    assert (await _call(db, customer, "POST", url, {"received": True})).status_code == 403
    r = await _call(db, contractor, "POST", url, {"received": True})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"
    await db.refresh(project)
    assert project.budget_spent == 5000
    # повтор безопасен, второй расход не создаётся
    assert (await _call(db, contractor, "POST", url, {"received": True})).status_code == 200
    await db.refresh(project)
    assert project.budget_spent == 5000
    events = (await db.execute(select(PaymentEvent).where(PaymentEvent.payment_id == pay_id))).scalars().all()
    assert [e.evidence_type for e in events] == ["recipient_confirmed"]


@pytest.mark.asyncio
async def test_recipient_denies_money_returns_invoice_to_pending(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 5000, status=PaymentStatus.paid_unverified)
    pay_id = pay.id
    url = f"/api/v1/projects/{PID}/payments/{pay_id}/recipient-response"
    r = await _call(db, contractor, "POST", url, {"received": False, "note": "не пришло"})
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    await db.refresh(project)
    assert project.budget_spent == 0
    # на pending «получено» ответить нельзя
    r = await _call(db, contractor, "POST", url, {"received": True})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "payment_not_awaiting_recipient"


# --- MNY-006: отмена и правка -----------------------------------------

@pytest.mark.asyncio
async def test_contractor_cancels_and_customer_rejects_pending_invoice(db):
    customer, contractor, project, stage = await _seed(db)
    a = await _invoice(db, project, stage, 3000)
    a_id = a.id
    b = await _invoice(db, project, stage, 3000)
    b_id = b.id
    base = f"/api/v1/projects/{PID}/payments"

    r = await _call(db, contractor, "POST", f"{base}/{a_id}/cancel", {"reason": "ошибся суммой"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert (await _call(db, contractor, "POST", f"{base}/{a_id}/cancel", {})).status_code == 200  # replay
    r = await _call(db, customer, "POST", f"{base}/{b_id}/cancel", {"reason": "дубль"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"

    done = await _invoice(db, project, stage, 1000, status=PaymentStatus.confirmed)
    done_id = done.id
    r = await _call(db, contractor, "POST", f"{base}/{done_id}/cancel", {})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "payment_not_cancellable"


@pytest.mark.asyncio
async def test_only_author_side_may_edit_pending_invoice(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 3000)
    pay_id = pay.id
    base = f"/api/v1/projects/{PID}/payments/{pay_id}"
    assert (await _call(db, customer, "PATCH", base, {"amount": 2000})).status_code == 403
    r = await _call(db, contractor, "PATCH", base, {"amount": 2500, "title": "Счёт (исправлен)"})
    assert r.status_code == 200
    assert r.json()["amount"] == 2500
    # выше суммы этапа — нельзя
    r = await _call(db, contractor, "PATCH", base, {"amount": 10001})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "stage_invoice_exceeds_stage_amount"
    pay.status = PaymentStatus.paid_unverified
    await db.commit()
    assert (await _call(db, contractor, "PATCH", base, {"amount": 1000})).status_code == 409


# --- MNY-005/007/008: сумма этапа и автосчёт ---------------------------

@pytest.mark.asyncio
async def test_sum_of_stage_invoices_cannot_exceed_stage_amount(db):
    customer, contractor, project, stage = await _seed(db, stage_amount=10000)
    base = f"/api/v1/projects/{PID}/payments"
    body = lambda pct: {"title": "Счёт", "payment_type": "stage", "stage_id": SID, "percent": pct}
    assert (await _call(db, contractor, "POST", base, body(60))).status_code == 200
    r = await _call(db, contractor, "POST", base, body(60))
    assert r.status_code == 409
    assert "не может быть больше суммы этапа" in r.json()["detail"]["message"]
    # частичный счёт не блокирует счёт на остаток
    assert (await _call(db, contractor, "POST", base, body(40))).status_code == 200


@pytest.mark.asyncio
async def test_cancelled_invoice_frees_stage_amount_and_autoinvoice_is_recreated(db):
    customer, contractor, project, stage = await _seed(db, stage_amount=10000)
    cancelled = await _invoice(db, project, stage, 10000, status=PaymentStatus.cancelled)
    cancelled_id = cancelled.id

    created = await ensure_stage_payment(db, project, stage, customer.id)
    assert created is not None and created.id != cancelled_id
    await db.flush()
    assert created.status == PaymentStatus.pending and created.amount == 10000
    await db.commit()
    # повторная приёмка не плодит дубль
    again = await ensure_stage_payment(db, project, stage, customer.id)
    assert again.id == created.id


@pytest.mark.asyncio
async def test_autoinvoice_covers_only_remainder_after_partial_invoice(db):
    customer, contractor, project, stage = await _seed(db, stage_amount=10000)
    partial = await _invoice(db, project, stage, 3000)
    partial_id = partial.id
    rest = await ensure_stage_payment(db, project, stage, customer.id)
    assert rest is not None and rest.id != partial_id
    assert rest.amount == 7000


# --- JRN-006: платёж этапа -> факт ------------------------------------

@pytest.mark.asyncio
async def test_confirmed_stage_payment_is_in_budget_spent_and_progress(db):
    customer, contractor, project, stage = await _seed(db, stage_amount=10000)
    pay = await _invoice(db, project, stage, 10000)
    pay_id = pay.id
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/receipts/manual",
                    {"payment_id": pay_id, "amount": 10000, "description": "перевод"})
    assert r.status_code == 200
    r = await _call(db, customer, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/confirm", {})
    assert r.json()["status"] == "confirmed"
    await db.refresh(project)
    assert project.budget_spent == 10000
    r = await _call(db, customer, "GET", f"/api/v1/projects/{PID}/stages/{SID}/payment-progress")
    assert r.json()["confirmed"] == 10000 and r.json()["remaining"] == 0


# --- JRN-008: closeout без «подтверждения неоплаченного» ---------------

@pytest.mark.asyncio
async def test_cancelled_invoice_does_not_block_closeout_checklist(db):
    customer, contractor, project, stage = await _seed(db)
    pay = await _invoice(db, project, stage, 5000)
    pay_id = pay.id
    r = await _call(db, customer, "GET", f"/api/v1/projects/{PID}/closeout-checklist")
    assert r.json()["pending_payments"] == 1
    await _call(db, contractor, "POST", f"/api/v1/projects/{PID}/payments/{pay_id}/cancel", {})
    r = await _call(db, customer, "GET", f"/api/v1/projects/{PID}/closeout-checklist")
    assert r.json()["pending_payments"] == 0


# --- MNY-022: знак суммы в выписке -------------------------------------

def test_bank_statement_keeps_sign_incoming_is_not_expense():
    text = "Дата;Сумма;Назначение\n01.09.2026;-5000;Оплата плитки\n02.09.2026;12000;Зарплата\n"
    rows, skipped = parse_bank_statement(text)
    assert [(r["amount"], r["description"]) for r in rows] == [(5000.0, "Оплата плитки")]
    assert skipped == 1


def test_bank_statement_explicit_plus_and_split_columns():
    rows, skipped = parse_bank_statement("Дата;Сумма;Назначение\n01.09.2026;+12000;Возврат\n02.09.2026;-300;Кран\n")
    assert [r["amount"] for r in rows] == [300.0] and skipped == 1
    split = "Дата;Приход;Расход;Назначение\n01.09.2026;12000;;Аванс клиента\n02.09.2026;;4500;Материалы\n"
    rows, skipped = parse_bank_statement(split)
    assert [r["amount"] for r in rows] == [4500.0] and skipped == 1


def test_bank_statement_unsigned_column_stays_expenses():
    rows = parse_bank_statement_csv("Дата;Сумма;Назначение\n01.09.2026;5000;Плитка\n02.09.2026;300;Кран\n")
    assert [r["amount"] for r in rows] == [5000.0, 300.0]


@pytest.mark.asyncio
async def test_budget_summary_shows_unverified_paid_amount_outside_fact(db):
    customer, contractor, project, stage = await _seed(db)
    await _invoice(db, project, stage, 4000, status=PaymentStatus.paid_unverified)
    r = await _call(db, customer, "GET", f"/api/v1/projects/{PID}/budget-summary")
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]
    assert summary["budget_spent"] == 0
    assert summary["paid_unverified_total"] == 4000 and summary["paid_unverified_count"] == 1
