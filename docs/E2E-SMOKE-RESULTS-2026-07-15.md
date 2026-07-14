# E2E smoke results — 2026-07-15

**Репозиторий:** https://github.com/PetrFedin/renova  
**Ветка:** `develop`  
**Команда:** `bash scripts/e2e-smoke.sh`  
**API:** `http://127.0.0.1:8100` (`environment=development`)  
**Preview:** `http://127.0.0.1:8081/iphone-preview.html`

## Run 1 (до Wave 3 membership ACL) — PASS

```
E2E OK: project=… stage=… status=done
E2E guest: projects=2 OK
E2E documents: upload OK
E2E documents: archive/restore OK
E2E documents: foreign access 404 OK
E2E documents: viewer read-only OK
E2E stages: count=6 OK
E2E extended: acceptance + payment gate + next stage + PDF + receipts + digest + expenses OK
EXIT:0
```

Чеклист `MAIN-MERGE-CHECKLIST.md`: критерий «E2E locally» отмечен после повторного зелёного прогона с Wave 3 блоками ниже.

## Run 2 (после media ACL + legal hold) — PASS (`EXIT:0`)

```
E2E OK: project=… stage=… status=done
E2E guest: projects=2 OK
E2E documents: upload / archive/restore / foreign 404 / viewer read-only OK
E2E media ACL: noauth=401 owner=200 foreign=404 OK
E2E legal hold: block-delete=409 OK
E2E stages: count=6 OK
E2E extended: acceptance + payment gate + next stage + PDF + receipts + digest + expenses OK
```

## Зачем в git

Артефакт готовности staging: не только «скрипт есть», а зафиксированный прогон на живом API.
