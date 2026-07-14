# Document Center — Wave 3c (OCR async worker + staging Postgres)

**Дата:** 2026-07-15  
**Ветка:** `develop`

## OCR async worker

### Режимы (`DOCUMENT_OCR_MODE`)

| Mode | Upload | Обработка |
|------|--------|-----------|
| `sync` (default) | enqueue + run stub в том же запросе | как Wave 3b |
| `async` | только `ocr_status=queued` | worker loop и/или `POST /api/v1/ocr/worker/tick` |

### Код

- `backend/app/services/document_ocr_worker.py` — batch + lifespan loop
- `backend/app/api/v1/ocr_worker.py` — `GET /ocr/worker`, `POST /ocr/worker/tick`
- Settings: `document_ocr_mode`, `document_ocr_worker_interval_sec`

### Зачем

Upload latency не зависит от classify; status machine уже async-ready. Реальный OCR engine позже заменяет только `run_ocr_stub`.

### Acceptance

- Unit: `tests/test_document_ocr_worker.py`
- E2E: `E2E OCR worker: status+tick OK`
- Staging smoke: API с `DOCUMENT_OCR_MODE=async` поднимается

## Staging Postgres path

См. `docs/STAGING-POSTGRES-SMOKE.md`.

## Не делаем

- Merge PR #2 без human OK
- Kontur SDK / настоящий OCR cloud

## Alembic Postgres gaps

См. таблицу в `STAGING-POSTGRES-SMOKE-RESULTS-2026-07-15.md` (`material_picks`, `chat_thread_reads`, `work_acceptances`).
