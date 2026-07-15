# Renova v0.2.0 — merged (2026-07-15)

**Репозиторий:** https://github.com/PetrFedin/renova  
**PR:** https://github.com/PetrFedin/renova/pull/2 — **MERGED**  
**Merge commit (main):** `9cc3cc7`  
**Tag:** [`v0.2.0`](https://github.com/PetrFedin/renova/releases/tag/v0.2.0)  
**Release:** https://github.com/PetrFedin/renova/releases/tag/v0.2.0  

## Gates before merge

| Gate | Result |
|------|--------|
| `CI` e2e (SQLite smoke) | PASS |
| `CI` e2e Alembic Postgres | PASS |
| `CI` playwright | PASS |
| NotificationType accept path | fixed `da674dc` |
| Alembic in CI env | fixed `b1f96b4` |

## Что вошло

- Document Center 0.2 (waves 2–3f)
- Environment profiles / staging Postgres smoke
- Offline queue + plan/fact
- Work acceptances, OCR async, e-sign sandbox scaffold

## Следующие приоритеты (post-v0.2)

1. TestFlight build по `docs/TESTFLIGHT-NOTES-v0.2.md`
2. Real Kontur/Goskey HTTP (не sandbox-only)
3. Real OCR engine (сейчас heuristics + async flags)
4. `poetry.lock` с `alembic` (PyPI был недоступен локально при cut)
5. По желанию: починить `eas-build.yml` (падает отдельно от CI; не блокировал merge)

## Команды проверки на main

```bash
git checkout main && git pull
git describe --tags --exact-match   # → v0.2.0
npm run test:priority
```

## TestFlight prep wave (2026-07-15)

- `docs/TESTFLIGHT-PREP-RUNBOOK.md`, `docs/EAS-BUILD-FIX-2026-07-15.md`
- `npm run testflight:preflight`, profile `testflight` in eas.json
- Ops: set real staging `EXPO_PUBLIC_API_URL`, then EAS build
