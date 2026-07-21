# P3-WAVE11 — Golden path E2E + registry v3 + Kontur health (2026-07-17)

## Закрыто

| ID | Задача |
|----|--------|
| P3-W11.1 | Backend `test_contract_gate_golden_path.py` — lock → sign → start |
| P3-W11.2 | Playwright `e2e/contract-gate-path.spec.ts` (API E2E) |
| P3-W11.3 | Registry v3 audit — `legacyRoutes.test.ts` проверяет thin redirect files |
| P3-W11.4 | `GET /api/v1/esign/health` — kontur mode + webhook URLs |
| P3-W11.5 | Staging env notes для PUBLIC_BASE_URL + ESIGN_WEBHOOK_SECRET |

## Тесты

```bash
cd backend && .venv/bin/python -m pytest tests/test_contract_gate_golden_path.py tests/test_esign_providers.py::test_esign_health_endpoint -q
npx playwright test e2e/contract-gate-path.spec.ts
npm run test:routes
npm run test:priority
```

## Legacy tabs (registry v3)

Физическое удаление `app/(role)/(tabs)/plan|works|…` **не сделано** — нужны для Expo deep links.
Каждый файл — thin redirect (`LegacyTabRedirect` / `Redirect`).

## Следующий (P3-W12)

- Browser Playwright UI smoke на `/portal` + `/documents`
- Kontur live keys в staging secrets
- Удаление WIP routes (`reports`, `project-analytics`) после GA
