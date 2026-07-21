# P3-W20 — merge:check:live + push-ci-workflow helper

## Изменения

- **`scripts/start-api-dev.sh`** — поднять API :8100 (poetry или `.venv`)
- **`scripts/merge-check-live.sh`** + **`npm run merge:check:live`** — merge gate с auto-start API
- **`scripts/push-ci-workflow.sh`** + **`npm run ci:push-workflow`** — push `.github/workflows/ci.yml` после `gh auth refresh -s workflow`

## Использование

```bash
npm run merge:check:live     # перед PR #3 merge
npm run ci:push-workflow     # после workflow scope
```

Локальный `.github/workflows/ci.yml` (test-priority + playwright через `ci-playwright.sh`) — см. `docs/P3-W19-CI-WORKFLOW-PUSH-2026-07-18.md`.
