> **DONE:** merged + tagged — see `RELEASE-v0.2-MERGED.md`.

# Release v0.2.0 — prep package (до merge main)

**Дата:** 2026-07-15  
**Цель:** один документ для human merge [PR #2](https://github.com/PetrFedin/renova/pull/2) + tag + TestFlight.

## Когда мержить

Напиши в чат: **мержи PR #2**

Критерии уже green (см. `MERGE-READINESS-RESULTS-2026-07-15.md`, staging postgres PASS, waves 3–3f на develop).

## Что войдёт в v0.2.0 (кратко)

| Область | Содержание |
|---------|------------|
| Offline | canonical queue A-01, plan vs fact A-03 |
| Env | A-06 profiles, SECRET gates |
| Documents | upload, ACL media, legal hold, OCR sync/async, e-sign in_app + kontur/goskey scaffold |
| Mobile | Document Center hub actions + DocumentPicker |
| Staging | Postgres alembic path scripts |

## После merge (команды)

```bash
# после approve/merge PR #2
git checkout main && git pull origin main
git tag -a v0.2.0 -m "Renova 0.2.0 — Document Center + staging guards"
git push origin v0.2.0

# notes для TestFlight — docs/TESTFLIGHT-NOTES-v0.2.md
bash scripts/release-notes-v0.2.sh   # печатает changelog с develop
```

## Риски (повтор)

См. `MERGE-DEVELOP-TO-MAIN.md` — Alembic gaps закрыты в 3c; kontur по умолчанию 501.

## TestFlight build text (короткий)

```text
Renova 0.2 — документы (загрузка/подпись/OCR), офлайн-очередь, staging Postgres.
Проверьте: upload PDF, гость только чтение, приёмка→акт, offline sync.
Контур/Госключ — только если включены на staging (иначе недоступны).
```
