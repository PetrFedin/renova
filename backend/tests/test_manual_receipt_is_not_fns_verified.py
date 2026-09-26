"""Чек, набранный руками, помечался как проверенный ФНС.

`fns_verified=True` стояло в конструкторе жёстко, а `_manual_response`
возвращал `"verified": True`. Приложение рисует бейдж «✓ ФНС» именно по
этому полю, поэтому рукописная сумма выглядела подтверждённой налоговой.

При этом система тут же себе противоречила: `verification_status`
оставался `saved_unverified`, а `reverify` того же чека отвечал
`409 manual_receipt_not_reverifiable` — «ручной расход нельзя проверить
через ФНС».

Расход учитывается полностью и до, и после правки: меняется только
утверждение о проверке.
"""

from pathlib import Path

import app.api.v1.receipts as receipts_api


def _source() -> str:
    return Path(receipts_api.__file__).read_text(encoding="utf-8")


def _manual_block() -> str:
    src = _source()
    block = src.split("def _manual_response")[1].split("\n@router.")[0]
    return "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))


def test_manual_receipt_is_not_created_verified():
    src = _source()
    # Конструктор ручного чека — единственное место с fn="MANUAL".
    block = src.split('fn="MANUAL"')[1].split(")")[0]
    code = "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))
    assert "fns_verified=True" not in code, "ручной чек снова создаётся проверенным"
    assert "fns_verified=False" in code


def test_manual_response_does_not_claim_verification():
    code = _manual_block()
    assert '"verified": True' not in code, "ответ снова утверждает, что чек проверен"
    assert '"verified": False' in code


def test_manual_receipt_says_how_it_appeared():
    code = _manual_block()
    assert '"source": "manual"' in code, "источник чека пропал"
    assert "verification_status" in code, "состояние проверки не названо"


def test_reverify_still_refuses_manual_receipts():
    """Отказ перепроверки — та самая улика. Он должен остаться."""
    assert "manual_receipt_not_reverifiable" in _source()


def test_manual_receipt_still_counts_as_an_expense():
    """Правка касается только отметки о проверке, не учёта денег.

    На этом я и споткнулся: сняв ложную отметку «проверен ФНС», я вместе
    с ней снял и подтверждение расхода — `budget_spent` упал с 5 432,10
    до нуля, потому что статус расхода определялся одним лишь
    `fns_verified`. Величины разведены, и проверка ниже это сторожит.
    """
    src = _source()
    # В файле два конструктора Receipt — сканированный и ручной. Нужен тот,
    # где fn="MANUAL".
    manual_at = src.index('fn="MANUAL"')
    start = src.rindex("rec = Receipt(", 0, manual_at)
    block = src[start:src.index("\n    )", manual_at)]
    for field in ("amount=round(body.amount, 2)", "expense_category=category", "room_id=room_id"):
        assert field in block, f"ручной чек перестал записывать {field}"


def test_expense_status_separates_verification_from_accounting():
    """Ручной чек — подтверждённый расход, хотя ФНС его не проверяла."""
    from app.services.budget_service_legacy import expense_status_for_receipt

    class _Rec:
        def __init__(self, fns_verified, fn, verification_status):
            self.fns_verified = fns_verified
            self.fn = fn
            self.verification_status = verification_status

    assert expense_status_for_receipt(_Rec(False, "MANUAL", "manual_entry")) == "confirmed", (
        "ручной чек перестал попадать в потраченное"
    )
    assert expense_status_for_receipt(_Rec(True, "1234", "verified_live")) == "confirmed"
    # Сканированный и не прошедший проверку — по-прежнему не в счёт.
    assert expense_status_for_receipt(_Rec(False, "1234", "saved_unverified")) == "pending_receipt"


def test_both_budget_services_use_the_same_rule():
    """Иначе величины снова разъедутся: расход заводится в двух местах."""
    from pathlib import Path

    import app.services.budget_service as budget
    import app.services.budget_service_legacy as legacy

    for module in (budget, legacy):
        code = Path(module.__file__).read_text(encoding="utf-8")
        assert '"confirmed" if rec.fns_verified else "pending_receipt"' not in code, (
            f"{module.__name__} снова считает расход подтверждённым по проверке ФНС"
        )
        assert "expense_status_for_receipt(rec)" in code
