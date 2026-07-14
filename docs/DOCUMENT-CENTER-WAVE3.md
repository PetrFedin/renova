# Document Center — Wave 3

**Дата:** 2026-07-15  
**Ветка:** `develop`  
**Репозиторий:** https://github.com/PetrFedin/renova

## Цель волны

Закрыть дыры после Wave 2 (upload/archive/privacy): **доступ к файлам media**, **legal hold**, задел под OCR / e-sign. Всё — в каноне `ProjectDocument`, без параллельного Document Center.

## Статус срезов

| Slice | Status | Код / док |
|-------|--------|-----------|
| Nested media paths `documents/{project_id}/file` | **done** | `backend/app/api/v1/media.py` |
| Soft ACL: documents/* → X-User-Id | **done** → superseded | 401 без header |
| Full project membership на media | **done** | `document_media_acl.py` + privacy 404 |
| Legal hold / retention | **done (MVP)** | колонки + `POST …/legal-hold` + блок delete |
| OCR / auto-classify | **done (stub)** | см. `DOCUMENT-CENTER-WAVE3B.md` |
| External e-sign | planned | после аккредитации провайдера |
| Merge develop → main | gated | `MAIN-MERGE-CHECKLIST.md` |

## Media membership ACL — зачем и как

**Проблема:** после Wave 3 soft ACL любой аутентифицированный пользователь мог скачать `documents/{чужой_uuid}/…`, зная/угадав путь.

**Решение:**
1. `parse_document_media_key(key)` — извлекает `project_id`, режет `..` traversal.
2. `assert_document_media_access` — `get_project` + `can_access_project`; нет доступа → **404** (как D-07).
3. `photos/*` без project ACL (как раньше); upload-url по-прежнему требует auth.

**Endpoints:**
- `GET /api/v1/media/documents/{project_id}/…`
- `GET /api/v1/media/presign/documents/{project_id}/…`

**Ожидаемые коды:**

| Кто | documents/* |
|-----|-------------|
| без X-User-Id | 401 |
| owner / contractor / guest viewer | 200 |
| foreign (не shared) | 404 |
| photos/* без auth | 200 (legacy public) |

## Legal hold — MVP

**Зачем:** акт/договор нельзя «удалить» во время спора; audit trail важнее UX purge.

**Модель** (`project_documents`):
- `legal_hold: bool` (default false)
- `retention_until: datetime | null`

**API:** `POST /api/v1/projects/{id}/documents/{doc_id}/legal-hold`  
Body: `{ "enabled": true, "retention_until": "2030-01-01T00:00:00" }`

**Side effect:** `DELETE` при hold → **409** `legal_hold_blocks_delete` (как signed docs).

**Миграции:**
- Alembic: `n4o5p6q7r8s9_document_legal_hold.py`
- SQLite local: `sqlite_compat.py` ALTER

## Acceptance

1. Unit: `pytest tests/test_document_media_acl.py tests/test_project_documents.py`
2. E2E: media noauth 401 / owner 200 / foreign 404; legal-hold delete 409
3. `docs/E2E-SMOKE-RESULTS-2026-07-15.md` обновлён после прогона

## Не делаем в этой волне

- Полный retention cron (auto-release after `retention_until`)
- OCR pipeline / e-sign provider
- Auto-merge в `main`

## Related

- `docs/DOCUMENT-CENTER-WAVE2.md`
- `docs/INCIDENT-2026-07-15-API-MULTIPART.md`
- `docs/E2E-SMOKE-RESULTS-2026-07-15.md`
- `docs/MAIN-MERGE-CHECKLIST.md`
