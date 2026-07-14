# Document Center — Wave 3b (OCR stub + e-sign providers)

**Дата:** 2026-07-15  
**Ветка:** `develop`  
**Репозиторий:** https://github.com/PetrFedin/renova  
**Предшественник:** `DOCUMENT-CENTER-WAVE3.md` (media ACL + legal hold)

## Зачем этот срез

После Wave 3 файлы защищены, soft-delete под hold заблокирован. Следующий продуктовый зазор Document Center:

1. Upload часто остаётся `document_type=upload` — нужен **классификатор** (сначала stub, потом OCR).
2. Подпись только «в приложении» — нужен **контракт провайдеров**, чтобы Kontur/Госключ не потребуют переписки API.

Оба куска **не** блокируют staging merge, но закрывают архитектурный долг до TestFlight документации / юридической ветки.

---

## OCR classify stub

### Модель (`document_versions`)

| Поле | Смысл |
|------|--------|
| `ocr_status` | `none` → `queued` → `processing` → `done` \| `failed` |
| `ocr_job_id` | id задачи (`ocr-…`) |
| `ocr_suggested_type` | канонический `DocumentType` |
| `ocr_confidence` | 0…1 |
| `ocr_completed_at` | UTC |
| `ocr_error` | текст при failed |

### Сервис

`backend/app/services/document_ocr_service.py`

- `classify_heuristic(title, filename, mime)` — RU/EN правила (договор → contract, акт → acceptance_act, …).
- `enqueue_ocr` / `run_ocr_stub` / `enqueue_and_run`.
- При `confidence ≥ 0.7` и типе `upload|other` — **apply** на `ProjectDocument.document_type`.

### API

| Method | Path | Поведение |
|--------|------|----------|
| auto | `POST …/documents/upload` | после сохранения файла → enqueue+run stub |
| GET | `…/documents/{id}/ocr` | статус |
| POST | `…/documents/{id}/ocr` | перезапуск; body `{ "apply_type": true }` |

Ответ документа: `meta.ocr = { status, job_id, suggested_type, confidence, … }`.

### Почему sync stub сейчас

Нет отдельного worker/Redis job в MVP. Флаги уже «async-ready»: worker сможет брать `ocr_status=queued` без смены API. Реальный OCR (Tesseract/Vision) — следующий milestone, тот же status machine.

### Миграции

- Alembic: `o5p6q7r8s9t0_document_ocr_esign.py`
- SQLite local: `sqlite_compat.py`

---

## E-sign provider interface

### Пакет

```
backend/app/services/esign/
  base.py          # SignRequest / SignResult / Protocol
  in_app.py        # доступен всегда
  external_stub.py # kontur, goskey — available=False
  registry.py      # get_provider / list_providers
```

### API

| Method | Path | Поведение |
|--------|------|----------|
| GET | `/api/v1/esign/providers` | каталог + `available` |
| POST | `…/documents/{id}/sign` | body: `{ "provider": "in_app" \| "kontur" \| "goskey", … }` |

- `in_app` → 200 + `DocumentSignature.provider_name/external_id`
- `kontur` / `goskey` → **501** `provider_unavailable:…` (пока нет ключей/аккредитации)
- неизвестный provider → 400

### Модель подписи

На `document_signatures`: `provider_name`, `provider_external_id` (+ прежний `meta_json` из SignResult.meta).

### Связи на будущее

- UI Document Center: список `GET /esign/providers` → показать только `available`.
- Юр. акт / legal hold: внешняя подпись должна писать content_hash и external_id (уже в SignResult).
- Не плодить второй `/sign` endpoint под каждого провайдера.

---

## Acceptance

1. Unit: `pytest tests/test_document_ocr.py tests/test_esign_providers.py`
2. E2E строки:
   - `E2E OCR: classify+apply OK`
   - `E2E e-sign: providers+in_app+kontur501=501 OK`
3. `npm run test:priority` green
4. Этот файл + обновления plan/checklist в git

## Не делаем здесь

- Реальный OCR / очередь Celery
- Интеграция Kontur SDK / Госключ
- Auto-merge `develop` → `main`

## Оценка

Document Center архитектурная готовность: **~8.2 / 10** (было ~8.0 после ACL/hold).  
Общая staging readiness: **~82%** (OCR/e-sign контракты закрыты; merge main — осознанный шаг по checklist).
