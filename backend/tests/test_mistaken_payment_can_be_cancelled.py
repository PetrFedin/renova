"""Ошибочно созданный счёт можно отменить.

Найдено разбором полноты жизненного цикла сущностей.

`PaymentStatus.cancelled` и `refunded` объявлены в модели и **читаются**
охранами (`payment_evidence_service`, `bank_statement_integrity`), но ни
один маршрут их не ставил. Ошибочный счёт висел `pending` навсегда: из
списка не убрать, в сверке он мешает.
"""
import pathlib

import pytest

from app.models.entities import Payment, PaymentStatus, PaymentType

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROUTES = (ROOT / "app" / "api" / "v1" / "payments.py").read_text()
SERVICE = (ROOT / "app" / "services" / "payment_service.py").read_text()


def _service_block() -> str:
    return SERVICE.split("async def cancel_payment")[1].split("async def confirm_payment")[0]


async def _seed(db, status: PaymentStatus = PaymentStatus.pending) -> Payment:
    payment = Payment(
        project_id="p1",
        amount=9000.0,
        status=status,
        title="Аванс",
        payment_type=PaymentType.advance,
        created_by="u1",
    )
    db.add(payment)
    await db.flush()
    await db.commit()
    return payment


def test_route_exists_and_requires_write():
    assert '@router.post("/{project_id}/payments/{payment_id}/cancel", response_model=PaymentOut)' in ROUTES
    block = ROUTES.split('/payments/{payment_id}/cancel"')[1].split("@router.")[0]
    assert "write=True" in block


@pytest.mark.asyncio
async def test_pending_payment_is_cancelled(db):
    from app.services.payment_service import cancel_payment

    payment = await _seed(db)
    result = await cancel_payment(db, payment.id, project_id="p1", actor_id="u1")
    assert result is not None
    assert result.status == PaymentStatus.cancelled


@pytest.mark.asyncio
async def test_confirmed_payment_is_not_rewritten(db):
    # Подтверждённый счёт — состоявшийся расчёт. Для спора есть dispute.
    from app.services.payment_service import cancel_payment

    payment = await _seed(db, status=PaymentStatus.confirmed)
    with pytest.raises(ValueError, match="payment_not_pending"):
        await cancel_payment(db, payment.id, project_id="p1", actor_id="u1")


@pytest.mark.asyncio
async def test_repeat_is_not_an_error(db):
    from app.services.payment_service import cancel_payment

    payment = await _seed(db)
    first = await cancel_payment(db, payment.id, project_id="p1", actor_id="u1")
    second = await cancel_payment(db, payment.id, project_id="p1", actor_id="u1")
    assert first is not None and second is not None
    assert second.status == PaymentStatus.cancelled


@pytest.mark.asyncio
async def test_payment_of_another_project_is_not_touched(db):
    from app.services.payment_service import cancel_payment

    payment = await _seed(db)
    assert await cancel_payment(db, payment.id, project_id="другой", actor_id="u1") is None


@pytest.mark.asyncio
async def test_missing_payment_is_not_a_crash(db):
    from app.services.payment_service import cancel_payment

    assert await cancel_payment(db, "нет-такого", project_id="p1", actor_id="u1") is None


@pytest.mark.asyncio
async def test_reason_is_kept_with_the_payment(db):
    from app.services.payment_service import cancel_payment

    payment = await _seed(db)
    result = await cancel_payment(db, payment.id, project_id="p1", actor_id="u1", reason="дубль")
    assert result is not None
    assert "отменён: дубль" in result.title


def test_receipt_blocks_blind_cancellation():
    block = _service_block()
    assert "receipt_id_for_payment" in block
    assert 'raise ValueError("payment_has_receipt")' in block


def test_budget_is_recalculated():
    block = _service_block()
    assert "refresh_budget_facts" in block, "отменённый счёт остался бы в деньгах"


def test_cancellation_leaves_a_trace():
    block = _service_block()
    assert '"title": "Счёт отменён"' in block


def test_refund_is_not_conflated_with_cancellation():
    # Возврат денег — движение средств, а не отмена ошибки.
    block = _service_block()
    assert "PaymentStatus.refunded" not in block


def test_confirm_path_is_unchanged():
    # Проверка не должна проходить оттого, что сломалось подтверждение.
    assert '@router.post("/{project_id}/payments/{payment_id}/confirm", response_model=PaymentOut)' in ROUTES
    assert "Подтверждает оплату заказчик" in ROUTES
