# Document Center — Wave 2 (D-04 / D-06 / D-07)

**Дата:** 2026-07-15  
**Ветка:** `develop`  
**Репозиторий:** https://github.com/PetrFedin/renova

## Цель волны

Закрыть пробелы Document Center после MVP-модели (Wave 1):

| ID | Было | Стало в Wave 2 |
|----|------|----------------|
| D-06 | только metadata JSON | **multipart upload** файла → storage + version |
| D-04 | только archive | **restore** + **soft-delete**; signed → нельзя delete |
| D-07 | smoke на акт | + upload/archive/restore + foreign **404** + viewer read-only |

---

## API

### Upload (D-06)

```
POST /api/v1/projects/{project_id}/documents/upload
Content-Type: multipart/form-data
X-User-Id: <writer>

file: <binary>
title?: string
document_type?: contract|warranty|upload|...
stage_id?: string
payment_id?: string
notes?: string
```

Ответ — canonical document dict (`source: canonical`, `href`, `version`, `checksum`).

Лимит: **20 MB**.  
Storage: `storage_service.save_bytes` → local `uploads/` или S3.  
Public href: `/api/v1/media/documents/{project_id}/…`

### Archive / Restore (D-04)

```
POST .../documents/{id}/archive   → status=archived
POST .../documents/{id}/restore   → status=active
DELETE .../documents/{id}         → soft deleted
```

Правила:

1. `restore` только из `archived` (не из `deleted`)
2. Если есть `DocumentSignature` → DELETE → **409** `signed_document_cannot_be_deleted`
3. Подписанный документ можно только архивировать

### Privacy (D-07)

`require_project_docs`: нет доступа / нет проекта → **404** `document_or_project_not_found`  
(не раскрываем существование проекта/документа).

Viewer (`write=False`): GET list OK, upload → 403/404.

---

## Mobile

`apps/mobile/lib/api/documents.ts`:

- `uploadProjectDocument`
- `restoreProjectDocument`
- `deleteProjectDocument`

`apps/mobile/lib/api/client.ts`: FormData не форсирует `Content-Type: application/json`.

---

## Tests

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_project_documents.py tests/test_environment_guards.py -q
# e2e (нужен живой API :8100):
bash scripts/e2e-smoke.sh
```

Покрывает: create/sign/archive/restore/signed-delete-block, save_bytes, e2e upload+privacy.

---

## Remaining (Wave 3+)

| Item | Why later |
|------|-----------|
| Legal hold / retention | compliance product |
| Multipart + OCR classify | P2 audit |
| External e-sign provider | accreditation |
| Binary download ACL beyond media key | harden media auth |
| Merge develop → main | `MAIN-MERGE-CHECKLIST.md` |

---

## Score impact

Documents domain: **6 → ~7.5 / 10**  
Overall readiness: **~74% → ~77%**
