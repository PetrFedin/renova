# CI proposals (not applied: pipeline changes are agreed separately)

Nothing under `.github/workflows` was modified. Every fragment below is ready to paste into the named workflow.
Time estimates are for `ubuntu-latest` and are estimates from local runs, not CI measurements.

| # | Step | Where | Added time |
|---|---|---|---|
| 1 | Typecheck ratchet, real errors = 0 (pin explicitly) | `ci.yml` job `mobile-contracts` | 0 (already runs) |
| 2 | `mobile:test` including calc-engine | `ci.yml` job `mobile-contracts` | 0 to +1 min |
| 3 | Journey regression `test_journey_regression.py` | new job or `backend-complete` | 1-2 min |
| 4 | Four technical-spec contract tests | `technical-spec-integrity.yml` | < 30 s |
| 5 | Schema drift ratchet | `backend-complete` (Postgres service) | ~20 s |
| 6 | Worker start in the integration check | `local-runtime-integrity.yml` or new job | 1-2 min |

## 1. Typecheck ratchet real = 0
`npm run typecheck:mobile` already fails closed when non-TS2786/TS2607 diagnostics exceed `TYPECHECK_BASELINE_REAL` (default 0 in `scripts/typecheck-mobile.sh`). Make the value explicit so it cannot be raised via a repo variable, and keep the report test:
```yaml
      - name: Mobile TypeScript integrity (ratchet real=0)
        env:
          TYPECHECK_BASELINE_REAL: "0"
        run: |
          npm run typecheck:mobile
          node --test scripts/typecheck-mobile-report.test.mjs
```

## 2. `mobile:test` with calc-engine
The script already ends with the calc-engine suites (`apps/mobile/lib/calc-engine/*.test.ts`, `packages/calc-engine/src/index.test.ts`). Add the standalone workspace run so a failure points at the package rather than the long `&&` chain:
```yaml
      - name: Calc-engine package tests
        run: npm run calc:test
      - name: Mobile domain and UI contracts (includes calc-engine call)
        run: npm run mobile:test
```

## 3. Journey regression
In-process ASGI on an isolated SQLite file; no external services. `xfail(strict=True)` marks open defects, so a fixed defect turns the job red until the mark is removed.
```yaml
  journey-regression:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      ENVIRONMENT: test
      DATABASE_URL: sqlite+aiosqlite:///./ci-journey.db
      PUBLIC_BASE_URL: http://127.0.0.1:8100
      SECRET_KEY: ci-secret-key-at-least-16
      ALLOW_CREATE_ALL: "true"
      ALLOW_DEMO_SEED: "true"
      PYTHONHASHSEED: "0"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12.13" }
      - name: Install locked backend dependencies
        working-directory: backend
        run: |
          python -m pip install --disable-pip-version-check "poetry==2.4.1"
          poetry sync --no-interaction
      - name: Lifecycle regression
        working-directory: backend
        run: poetry run pytest -q tests/test_journey_regression.py
```

## 4. Four specification contract tests
`technical-spec-integrity.yml` already lists three; add `devRuntimeContract` (it guards the canonical local profile, including the `S3_PUBLIC_URL` loopback rule and the host worker commands) and the path trigger for `scripts/dev-runtime.sh`, `docker-compose.yml`, `env.local.example`, `package.json`.
```yaml
      - name: Specification and runtime contracts
        run: |
          node --test \
            scripts/technicalSpecContract.test.mjs \
            scripts/technicalSpecAnnexContract.test.mjs \
            scripts/technicalSpecAlembicContract.test.mjs \
            scripts/devRuntimeContract.test.mjs
```
These compare blob SHAs of tracked files; any PR touching `package.json`, `scripts/*` or `backend/app/models/entities.py` must refresh `docs/technical-spec/` in the same PR.

## 5. Schema drift ratchet (APIB-039)
Uses the existing `postgres:17-alpine` service of `backend-complete` (port 5433). The test creates and drops a scratch database, so the `renova` DB is untouched; baseline is `backend/scripts/schema_drift_baseline.json`.
```yaml
      - name: Schema drift ratchet (models vs alembic head)
        working-directory: backend
        env:
          POSTGRES_TEST_URL: postgresql://renova:renova@127.0.0.1:5433/postgres
        run: poetry run pytest -q tests/test_schema_drift_ratchet.py
```
Also add `backend/scripts/schema_drift_*` and `backend/app/models/**` to the workflow path filters. Note: in `backend-complete` the env sets `DATABASE_URL=sqlite...`; the script overrides it for its own subprocess.

## 6. Worker start in the integration check (APIB-027)
The compose graph already contains `worker`; `local-runtime-integrity.yml` should assert the heartbeat, not just container start:
```yaml
      - name: Start API + worker and verify heartbeats
        run: |
          set -euo pipefail
          RENOVA_DEV_NO_EXPO=1 bash scripts/dev-runtime.sh start
          bash scripts/dev-runtime.sh check          # includes worker local + shared Redis heartbeat
      - name: Worker processes outbox without external sinks
        run: |
          docker compose --project-name renova-local --env-file .env.local logs worker | grep -q 'renova worker started tasks=domain_outbox'
          ! docker compose --project-name renova-local --env-file .env.local logs worker | grep -E 'Traceback|worker task crashed'
      - name: Teardown
        if: always()
        run: bash scripts/dev-runtime.sh stop
```
For a host-run API variant use `bash scripts/dev-runtime.sh worker-up && bash scripts/dev-runtime.sh worker-check`, then `worker-down` in an `always()` step.
