"""Содержание подписанного договора менялось задним числом.

`contract.pdf` рисуется по требованию из текущего состояния объекта, а
подпись `in_app` сохранялась без какой-либо привязки к содержанию: у
системной версии договора `checksum_sha256` пуст, а требование хеша стоит
только для внешних провайдеров.

На живом стенде это выглядело так: заказчик подписал договор на
298 266 ₽, затем одобрили доп. работы на 87 400 ₽ — и тот же документ с
той же подписью стал договором на 385 666 ₽. Доказать, что именно было
подписано, было нечем.
"""

import pytest

from app.services import contract_document_service as contract_svc


def _terms(**over) -> contract_svc.ContractTerms:
    base = dict(
        project_name="Квартира на Малой Бронной",
        address="г. Москва, ул. Малая Бронная, д. 18, кв. 44",
        customer="Северцев Аркадий Витальевич",
        contractor="ООО «СтройГвоздь»",
        works_total=150000.0,
        materials_total=148265.76,
        works_count=12,
        materials_count=12,
        change_orders_total=0.0,
        change_orders_count=0,
        vat_rate=0.0,
        locked_at="2026-09-23",
        stages=[("Подготовка", 8522.0), ("Демонтаж", 12000.0)],
    )
    base.update(over)
    return contract_svc.ContractTerms(**base)


def test_fingerprint_is_stable_for_the_same_terms():
    assert contract_svc.terms_fingerprint(_terms()) == contract_svc.terms_fingerprint(_terms())


def test_approved_change_orders_change_the_fingerprint():
    """Ровно тот случай, что был на стенде: доп. работы после подписи."""
    before = contract_svc.terms_fingerprint(_terms())
    after = contract_svc.terms_fingerprint(_terms(change_orders_total=87400.0, change_orders_count=1))
    assert before != after, "доп. работы не меняют отпечаток — подмену не поймать"


@pytest.mark.parametrize(
    "field,value",
    [
        ("customer", "Другой Заказчик"),
        ("contractor", "ООО «Другой»"),
        ("address", "другой адрес"),
        ("works_total", 999999.0),
        ("materials_total", 1.0),
        ("vat_rate", 20.0),
        ("stages", [("Подготовка", 1.0)]),
    ],
)
def test_every_material_term_changes_the_fingerprint(field, value):
    assert contract_svc.terms_fingerprint(_terms()) != contract_svc.terms_fingerprint(_terms(**{field: value}))


def test_immaterial_fields_do_not_change_the_fingerprint():
    """Счётчики строк — производные, на смысл договора не влияют.

    Иначе отпечаток ломался бы от переразбиения той же суммы по строкам,
    и документ кричал бы о подмене там, где её нет.
    """
    same = contract_svc.terms_fingerprint(_terms(works_count=1, materials_count=1))
    assert same == contract_svc.terms_fingerprint(_terms(works_count=12, materials_count=12))


def test_fingerprint_survives_float_representation():
    assert contract_svc.terms_fingerprint(_terms(works_total=150000.0)) == contract_svc.terms_fingerprint(
        _terms(works_total=150000.000000001)
    )


def test_signing_stores_the_fingerprint_on_the_version():
    """Подпись обязана привязываться к условиям, а не висеть в пустоте.

    Читаем исходник: подстановка отпечатка стоит до проверки провайдера,
    иначе `in_app` — а им подписывают внутри приложения — так и остался бы
    без привязки к содержанию.
    """
    from pathlib import Path

    import app.services.project_document_service as svc

    source = Path(svc.__file__).read_text(encoding="utf-8")
    block = source.split("async def sign_document")[1].split("\nasync def ")[0]
    code = "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))

    assert "terms_fingerprint(" in code, "подпись договора не привязывается к условиям"
    assert 'esign.name == "in_app"' in code, (
        "отпечаток подставляется и внешнему провайдеру — он обязан принести "
        "хеш настоящих байтов сам"
    )
    assert "version.checksum_sha256 = resolved_hash" in code, "отпечаток не сохраняется на версии"

    fingerprint_at = code.index("terms_fingerprint(")
    provider_guard_at = code.index("external_signature_content_hash_required")
    assert fingerprint_at < provider_guard_at, "отпечаток считается после проверки провайдера"


def test_contract_pdf_declares_a_change_after_signing():
    """Молчать о расхождении нельзя: документ обязан сказать о нём сам."""
    from pathlib import Path

    import app.api.v1.export as export

    source = Path(export.__file__).read_text(encoding="utf-8")
    block = source.split("async def export_contract")[1].split("\nasync def ")[0]
    code = "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))

    assert "signed_terms_fingerprint(" in code, "документ не спрашивает, под чем стоит подпись"
    assert "условия изменились после подписания" in code, "расхождение не названо в документе"
    assert "changed_after_signing" in code
