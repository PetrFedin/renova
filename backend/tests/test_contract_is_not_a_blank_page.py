"""Договор — документ с содержанием, а не бланк, под которым ставят подпись.

Найдено сквозным прогоном цепочки «смета → договор».

`ensure_contract_draft` создавала документ с одним заголовком «Договор
подряда» и пометкой «Создан автоматически при фиксации сметы». Ни суммы, ни
сторон, ни предмета, ни файла — `create_document` вызывался без `href`.

При этом такой документ можно было подписать, а подпись снимает гейт начала
работ: `project_contract_gate` пропускает проект, как только у любого
договора есть подпись со статусом `signed`, а гейт проверяется в
`stage_service.start_stage`.

То есть защита «работы не начнутся без договора» удовлетворялась подписью
под чистым листом.
"""
import pytest

from app.services.contract_document_service import (
    ContractTerms,
    contract_href,
    contract_notes,
)


def terms(**over) -> ContractTerms:
    base = dict(
        project_name="Демо-квартира",
        address="ул. Пример 12",
        customer="Иван Петров",
        contractor="Ремонт-Сервис",
        works_total=113630.0,
        materials_total=72308.0,
        works_count=14,
        materials_count=11,
        change_orders_total=8500.0,
        change_orders_count=1,
        vat_rate=0.0,
        locked_at="2026-09-17",
        stages=[("Демонтаж", 50000.0)],
    )
    base.update(over)
    return ContractTerms(**base)


def test_contract_without_price_is_not_signable():
    # Ровно тот случай, что был: документ есть, содержания нет.
    assert terms(works_total=0, materials_total=0, change_orders_total=0).is_signable() is False


def test_contract_without_any_estimate_line_is_not_signable():
    assert terms(works_count=0, materials_count=0).is_signable() is False


def test_real_contract_is_signable():
    # Проверка не должна проходить оттого, что подписать нельзя ничего.
    assert terms().is_signable() is True


def test_href_points_at_the_renderer():
    # Тот же приём, что у акта приёмки: ссылка на ручку, не хранимый файл.
    assert contract_href("p1") == "/api/v1/projects/p1/contract.pdf"


def test_card_shows_the_sum_without_opening_the_file():
    note = contract_notes(terms())
    assert "194 438" in note
    assert "Ремонт-Сервис" in note
    assert "2026-09-17" in note


def test_vat_is_named_not_implied():
    assert terms(vat_rate=0).vat_label == "Без НДС"
    assert terms(vat_rate=20).vat_label == "НДС 20%"


def test_zero_stages_are_left_out_of_the_payment_order():
    # Этап без суммы обещать к оплате нельзя — платить по нему нечего.
    assert terms(stages=[]).scheduled_payments == 0.0
    assert terms(stages=[("Демонтаж", 50000.0), ("Стены", 30000.0)]).scheduled_payments == 80000.0


def test_draft_carries_href_and_terms():
    """Черновик договора больше не создаётся пустым."""
    import pathlib

    source = (
        pathlib.Path(__file__).resolve().parents[1]
        / "app" / "services" / "project_document_service.py"
    ).read_text()
    block = source.split("async def ensure_contract_draft")[1].split("async def project_contract_gate")[0]
    assert "contract_svc.contract_href(project_id)" in block, "договор снова без ссылки на документ"
    assert "contract_svc.contract_notes" in block, "договор снова без суммы в карточке"
    assert 'notes="Создан автоматически при фиксации сметы"' not in block


def test_signing_refuses_a_contract_with_nothing_to_look_at():
    import pathlib

    source = (
        pathlib.Path(__file__).resolve().parents[1]
        / "app" / "services" / "project_document_service.py"
    ).read_text()
    block = source.split("async def sign_document")[1]
    assert "contract_has_no_content" in block, "пустой договор снова можно подписать"
    assert "_version_has_content(version)" in block


def test_content_is_a_property_of_the_document_not_of_the_estimate():
    """Ссылка, файл или контрольная сумма — любого из трёх достаточно."""
    from app.services.project_document_service import _version_has_content

    class V:
        def __init__(self, href=None, storage_key=None, checksum_sha256=None):
            self.href = href
            self.storage_key = storage_key
            self.checksum_sha256 = checksum_sha256

    assert _version_has_content(V(href="/api/v1/projects/p1/contract.pdf")) is True
    assert _version_has_content(V(storage_key="uploads/contract.pdf")) is True
    assert _version_has_content(V(checksum_sha256="a" * 64)) is True
    # Ровно тот случай, что был: версия без всего.
    assert _version_has_content(V()) is False


def test_the_gate_itself_is_unchanged():
    """Уже подписанные договоры не пересматриваются задним числом."""
    import pathlib

    source = (
        pathlib.Path(__file__).resolve().parents[1]
        / "app" / "services" / "project_document_service.py"
    ).read_text()
    gate = source.split("async def project_contract_gate")[1].split("async def complete_external_signature")[0]
    # Гейт по-прежнему пропускает по факту подписи; ужесточение стоит на входе,
    # а не задним числом — иначе у живых проектов внезапно встали бы этапы.
    assert 'DocumentSignature.status == "signed"' in gate
    assert "contract_has_no_content" not in gate


@pytest.mark.asyncio
async def test_collect_terms_on_missing_project_returns_none(db):
    from app.services.contract_document_service import collect_terms

    assert await collect_terms(db, "нет-такого-проекта") is None


def test_approved_change_orders_are_part_of_the_price():
    """Иначе договор называл бы цену меньше той, что показывает приложение."""
    t = terms()
    assert t.estimate_total == 185938.0
    assert t.total == 194438.0


def test_change_orders_are_shown_separately_not_dissolved():
    import pathlib

    source = (
        pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "export.py"
    ).read_text()
    block = source.split("async def export_contract")[1].split("@router.get")[0]
    assert "Доп. работы (согласованы)" in block
    assert "terms.estimate_total" in block, "смета и итог не разделены — цену не проверить"


def test_price_without_change_orders_equals_the_estimate():
    t = terms(change_orders_total=0.0, change_orders_count=0)
    assert t.total == t.estimate_total == 185938.0


def test_total_cannot_drift_from_its_parts():
    """Цена вычисляется из слагаемых — разойтись с ними она не может."""
    t = terms(works_total=100.0, materials_total=50.0, change_orders_total=25.0)
    assert t.estimate_total == 150.0
    assert t.total == 175.0
    assert "total" not in {f.name for f in __import__("dataclasses").fields(t)}
