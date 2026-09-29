"""Гарантийную претензию можно вернуть в работу.

Найдено разбором полноты жизненного цикла сущностей: закрытие есть
(`POST .../warranty-claims/{id}/close`), обратного перехода не было.
Закрыл по ошибке — и всё.

Это не просто потерянная запись. Открытая претензия **блокирует сдачу
объекта**, и её закрытие этот блокер снимает. То есть ошибочное закрытие
открывает закрытие объекта, а вернуть его было нечем.

Вместе с претензией архивировался её документ — значит и возвращать их
надо вместе, иначе претензия в работе, а бумага по ней в архиве.
"""
import pathlib

import pytest

from app.models.entities import Project, ProjectIssue, User, UserRole
from app.models.project_documents import DocumentStatus, DocumentType, ProjectDocument

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROUTES = (ROOT / "app" / "api" / "v1" / "export.py").read_text()


def _block() -> str:
    return ROUTES.split('@router.post("/{project_id}/warranty-claims/{issue_id}/reopen")')[1].split("@router.")[0]


async def _seed(db, *, status: str = "closed", title: str = "[Гарантия] Трещина"):
    user = User(id="u-cust", phone="+70000000001", role=UserRole.customer, full_name="Заказчик")
    project = Project(id="p1", name="Объект", customer_id="u-cust", renovation_type="cosmetic")
    issue = ProjectIssue(project_id="p1", title=title, status=status, severity="medium")
    db.add_all([user, project, issue])
    await db.flush()
    doc = ProjectDocument(
        project_id="p1",
        document_type=DocumentType.warranty.value,
        title="Гарантия",
        status=DocumentStatus.archived.value,
        notes=f"warranty_issue:{issue.id}",
        created_by="u-cust",
    )
    db.add(doc)
    await db.flush()
    await db.commit()
    return user, issue, doc


@pytest.mark.asyncio
async def test_closed_claim_returns_to_work(db):
    from app.api.v1.export import reopen_warranty_claim

    user, issue, _ = await _seed(db)
    result = await reopen_warranty_claim("p1", issue.id, user=user, db=db)

    assert result["ok"] is True
    assert result["replayed"] is False
    refreshed = await db.get(ProjectIssue, issue.id)
    assert refreshed.status == "open"
    assert refreshed.closed_at is None, "срок закрытия остался — претензия выглядит закрытой"


@pytest.mark.asyncio
async def test_document_comes_back_with_the_claim(db):
    from app.api.v1.export import reopen_warranty_claim

    user, issue, doc = await _seed(db)
    result = await reopen_warranty_claim("p1", issue.id, user=user, db=db)

    assert result["documents_restored"] == 1
    assert (await db.get(ProjectDocument, doc.id)).status == DocumentStatus.active.value


@pytest.mark.asyncio
async def test_repeat_on_an_open_claim_is_not_an_error(db):
    from app.api.v1.export import reopen_warranty_claim

    user, issue, _ = await _seed(db, status="open")
    result = await reopen_warranty_claim("p1", issue.id, user=user, db=db)
    assert result["replayed"] is True


@pytest.mark.asyncio
async def test_only_the_customer_reopens(db):
    from fastapi import HTTPException

    from app.api.v1.export import reopen_warranty_claim

    _, issue, _ = await _seed(db)
    contractor = User(
        id="u-contr", phone="+70000000002", role=UserRole.contractor, full_name="Исполнитель"
    )
    db.add(contractor)
    await db.commit()

    with pytest.raises(HTTPException) as error:
        await reopen_warranty_claim("p1", issue.id, user=contractor, db=db)
    assert error.value.status_code in (403, 404)
    assert (await db.get(ProjectIssue, issue.id)).status == "closed"


@pytest.mark.asyncio
async def test_ordinary_defect_is_not_a_warranty_claim(db):
    from fastapi import HTTPException

    from app.api.v1.export import reopen_warranty_claim

    user, issue, _ = await _seed(db, title="Скол плитки")
    with pytest.raises(HTTPException) as error:
        await reopen_warranty_claim("p1", issue.id, user=user, db=db)
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_claim_of_another_project_is_not_touched(db):
    from fastapi import HTTPException

    from app.api.v1.export import reopen_warranty_claim

    user, issue, _ = await _seed(db)
    db.add(Project(id="p2", name="Чужой", customer_id="u-cust", renovation_type="cosmetic"))
    await db.commit()

    with pytest.raises(HTTPException) as error:
        await reopen_warranty_claim("p2", issue.id, user=user, db=db)
    assert error.value.status_code == 404
    assert (await db.get(ProjectIssue, issue.id)).status == "closed"


def test_reopen_mirrors_the_close_permission():
    # Возвращает тот, кто закрывал.
    assert "warranty_reopen_customer_only" in _block()
    assert "warranty_close_customer_only" in ROUTES


def test_reopen_leaves_a_trace():
    assert '"WarrantyReopened"' in _block() or 'kind="WarrantyReopened"' in _block()


def test_reopen_does_not_swallow_document_errors_silently():
    # В close архивация документа обёрнута в `except Exception: pass`.
    # Копировать этот приём не стал: молчаливый провал скрыл бы, что бумага
    # осталась в архиве.
    assert "except Exception:" not in _block()


def test_close_path_is_unchanged():
    # Проверка не должна проходить оттого, что сломалось закрытие.
    assert '@router.post("/{project_id}/warranty-claims/{issue_id}/close")' in ROUTES
    assert 'issue.status = "closed"' in ROUTES
