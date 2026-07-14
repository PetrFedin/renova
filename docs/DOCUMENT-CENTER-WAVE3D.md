# Document Center — Wave 3d (Mobile hub actions)

**Дата:** 2026-07-15  
**Ветка:** `develop`  
**Репозиторий:** https://github.com/PetrFedin/renova

## Зачем

API Wave 3–3c уже умеет OCR / e-sign / legal hold / upload.  
В UI Document Center не хватало **следующего действия** на каноническом документе — индекс был read-mostly.

## Mobile изменения

### API client (`apps/mobile/lib/api/documents.ts`)
- `listEsignProviders`
- `signProjectDocument({ provider })`
- `getDocumentOcr` / `runDocumentOcr`
- `setDocumentLegalHold`
- `tickOcrWorker`
- upload / archive / restore / delete (как раньше)

### Meta helpers (`apps/mobile/lib/documentCenterMeta.ts`)
- OCR status label, legal hold flag, subtitle для списка
- Unit: `npm run test:docs-meta`

### DocumentsHub
- Meta строка: `legal hold` + OCR status
- Кнопка **+ Файл** (web file picker → multipart upload)
- Меню канонического документа:
  - Открыть
  - Подписать in_app
  - OCR classify
  - Legal hold on/off
  - Архив
- 501/provider_unavailable → понятный Alert

## Acceptance

1. `npm run test:docs-meta` OK
2. `npm run test:priority` green
3. Live: Document Center → upload → в индексе meta OCR; меню → подпись

## Не делаем

- Auto-merge PR #2
- Native DocumentPicker module (отмечено в Alert; web path рабочий для preview)
- Kontur SDK

## Связь

- Backend: WAVE3 / 3B / 3C
- PR #2 всё ещё ждёт human merge
