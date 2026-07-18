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
