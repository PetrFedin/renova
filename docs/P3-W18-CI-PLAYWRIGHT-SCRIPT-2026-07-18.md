# P3-W18 — CI Playwright script + test-priority job

## Изменения

- **`scripts/ci-playwright.sh`** — единый runner для CI/local (`api` | `ui` | `all`):
  - старт API / Expo web с ожиданием health
  - trap cleanup процессов
  - post-run `npm run cleanup:e2e-gate`
- **`.github/workflows/ci.yml`** — job `test-priority`; playwright через `ci-playwright.sh`
- **`package.json`** — `ci:playwright`, `e2e:ci` → script
- **`merge-readiness.sh`** — cleanup после `e2e:api`

## Локально

```bash
npm run test:priority
bash scripts/ci-playwright.sh api   # нужен poetry backend
npm run ci:playwright               # api + ui
```
