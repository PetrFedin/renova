# P3-W17 — CI Playwright + E2E cleanup

## Изменения

- **CI** (`.github/workflows/ci.yml`): job `playwright` запускает backend + `npm run e2e:api`, затем Expo web + `e2e:portal-ui` / `e2e:contract-gate-ui`. Убран фиктивный `e2e:web || true`.
- **npm scripts**: `e2e:api`, `e2e:ci`, `cleanup:e2e-gate`.
- **E2E cleanup**: `cleanupE2eGateProject()` в contract-gate specs; bulk script `scripts/cleanup-e2e-gate-projects.sh`.
- **merge:check**: при поднятом API добавлен `npm run e2e:api`.

## Проверка

```bash
npm run test:priority
# с API :8100
npm run e2e:api
npm run cleanup:e2e-gate
```

## CI workflow (manual push)

GitHub OAuth token без scope `workflow` — файл `.github/workflows/ci.yml` нужно закоммитить после:

```bash
gh auth refresh -h github.com -s workflow
git add .github/workflows/ci.yml
git commit -m "ci: playwright API + UI jobs (P3-W17 workflow file)"
git push origin develop
```

Или вставить через GitHub UI (Edit file).

<details>
<summary>.github/workflows/ci.yml</summary>

```yaml
name: CI
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_USER: renova, POSTGRES_PASSWORD: renova, POSTGRES_DB: renova }
        ports: ["5433:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install backend + start API + e2e-smoke
        working-directory: backend
        run: |
          set -euo pipefail
          pip install poetry
          poetry install --no-interaction
          poetry run pip install fpdf2 alembic
          export ENVIRONMENT=development
          export DATABASE_URL=sqlite+aiosqlite:///./ci.db
          export PUBLIC_BASE_URL=http://127.0.0.1:8100
          export SECRET_KEY=ci-secret-key-at-least-16
          poetry run uvicorn app.main:app --host 127.0.0.1 --port 8100 &
          for i in $(seq 1 30); do
            if curl -sf http://127.0.0.1:8100/health >/dev/null; then
              echo "API ready"
              break
            fi
            sleep 1
            if [ "$i" -eq 30 ]; then
              echo "API failed to start"
              exit 1
            fi
          done
          bash ../scripts/e2e-smoke.sh
      - name: Alembic on Postgres service (smoke)
        working-directory: backend
        env:
          ENVIRONMENT: staging
          DATABASE_URL: postgresql+asyncpg://renova:renova@127.0.0.1:5433/renova
          PUBLIC_BASE_URL: https://ci-staging.example.com
          SECRET_KEY: ci-staging-secret-key-32chars!!
          ALLOW_CREATE_ALL: "false"
          ALLOW_DEMO_SEED: "false"
        run: |
          set -euo pipefail
          poetry run python -m alembic upgrade head

  playwright:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install deps
        run: |
          set -euo pipefail
          npm ci
          npx playwright install chromium --with-deps
          cd backend
          pip install poetry
          poetry install --no-interaction
          poetry run pip install fpdf2 alembic
      - name: Playwright API E2E (:8100)
        working-directory: backend
        run: |
          set -euo pipefail
          export ENVIRONMENT=development
          export DATABASE_URL=sqlite+aiosqlite:///./ci-playwright.db
          export PUBLIC_BASE_URL=http://127.0.0.1:8100
          export SECRET_KEY=ci-secret-key-at-least-16
          poetry run uvicorn app.main:app --host 127.0.0.1 --port 8100 &
          for i in $(seq 1 30); do
            if curl -sf http://127.0.0.1:8100/health >/dev/null; then
              echo "API ready"
              break
            fi
            sleep 1
            if [ "$i" -eq 30 ]; then
              echo "API failed to start"
              exit 1
            fi
          done
          cd ..
          npm run e2e:api
      - name: Playwright UI E2E (:8100 + :8081)
        run: |
          set -euo pipefail
          cd backend
          export ENVIRONMENT=development
          export DATABASE_URL=sqlite+aiosqlite:///./ci-playwright-ui.db
          export PUBLIC_BASE_URL=http://127.0.0.1:8100
          export SECRET_KEY=ci-secret-key-at-least-16
          poetry run uvicorn app.main:app --host 127.0.0.1 --port 8100 &
          cd ../apps/mobile
          export BROWSER=none
          npx expo start --web --port 8081 &
          for i in $(seq 1 45); do
            if curl -sf http://127.0.0.1:8100/health >/dev/null && curl -sf http://127.0.0.1:8081/ >/dev/null; then
              echo "API + Expo web ready"
              break
            fi
            sleep 2
            if [ "$i" -eq 45 ]; then
              echo "Expo web failed to start"
              exit 1
            fi
          done
          cd ../..
          npm run e2e:portal-ui
          npm run e2e:contract-gate-ui

```

</details>

## P3-W18 (follow-up)

- `scripts/ci-playwright.sh` — DRY для CI/local: `api` | `ui` | `all`, trap cleanup, post-run `cleanup:e2e-gate`
- CI job `test-priority` — unit/backend guards на каждый push
- `npm run ci:playwright` / `e2e:ci` → `ci-playwright.sh all`
