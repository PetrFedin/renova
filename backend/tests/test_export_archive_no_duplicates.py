"""Повторная выгрузка — это новая версия документа, а не новый документ.

Найдено обходом живого приложения: на экране «Документы» демо-объекта
каждая выгрузка была показана четырьмя одинаковыми карточками
«Документ · Действует · v1». В базе на один объект оказалось по четыре
строки `project_documents` на каждую выгрузку — по одной на каждое
скачивание.

Причина: `register_export_in_documents` всегда звал `create_document`.
Но выгрузка — это ссылка на ручку, а не файл: `href` при каждом
скачивании один и тот же. Механизм версий в сервисе уже был — его и не
хватало на этом пути.
"""
import pytest

from app.services.integrations.export_archive import register_export_in_documents
from app.services.project_document_service import (
    create_document,
    list_canonical_documents,
)

HREF = "/api/v1/projects/p1/export/bank-register.csv"


async def _register(db, *, project_id="p1", title="Реестр для банка", href=HREF):
    return await register_export_in_documents(
        db,
        project_id=project_id,
        user_id="u1",
        title=title,
        href=href,
        notes="bank register",
    )


@pytest.mark.asyncio
async def test_repeated_export_keeps_one_document(db):
    first = await _register(db)
    second = await _register(db)
    third = await _register(db)

    assert first == second == third, "каждое скачивание заводило новый документ"

    items = await list_canonical_documents(db, "p1")
    assert len(items) == 1, f"в Центре документов {len(items)} карточек вместо одной"


@pytest.mark.asyncio
async def test_repeated_export_raises_the_version(db):
    await _register(db)
    items = await list_canonical_documents(db, "p1")
    assert items[0]["version"] == 1

    await _register(db)
    await _register(db)
    items = await list_canonical_documents(db, "p1")
    # История скачиваний не теряется: она становится версиями.
    assert items[0]["version"] == 3


@pytest.mark.asyncio
async def test_different_exports_stay_different_documents(db):
    await _register(db, title="Реестр для банка", href=HREF)
    await _register(db, title="Выгрузка 1С (XML)", href="/api/v1/projects/p1/export/1c-payments.xml")

    items = await list_canonical_documents(db, "p1")
    assert len(items) == 2
    assert {item["title"] for item in items} == {"Реестр для банка", "Выгрузка 1С (XML)"}


@pytest.mark.asyncio
async def test_export_of_another_project_is_not_reused(db):
    # Совпадение адресов между объектами невозможно, но условие по проекту
    # обязано стоять явно: без него чужой документ стал бы своим.
    await _register(db, project_id="p1")
    await _register(db, project_id="p2")

    assert len(await list_canonical_documents(db, "p1")) == 1
    assert len(await list_canonical_documents(db, "p2")) == 1


@pytest.mark.asyncio
async def test_first_export_still_creates_the_document(db):
    # Проверка не должна проходить оттого, что не создаётся вообще ничего.
    doc_id = await _register(db)
    assert doc_id

    items = await list_canonical_documents(db, "p1")
    assert items[0]["title"] == "Реестр для банка"
    assert items[0]["href"] == HREF
    assert items[0]["status"] == "active"


@pytest.mark.asyncio
async def test_unrelated_document_with_same_href_is_reused_not_shadowed(db):
    # Документ, заведённый другим путём, но с тем же адресом ручки — это тот
    # же документ. Дубля возникнуть не должно и здесь.
    await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Реестр для банка",
        href=HREF,
    )
    await db.commit()

    await _register(db)
    items = await list_canonical_documents(db, "p1")
    assert len(items) == 1
    assert items[0]["version"] == 2
