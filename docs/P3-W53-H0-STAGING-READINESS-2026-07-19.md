# P3-W53 — H0 staging readiness (2026-07-19)

## Зачем

Агенты: пилот/инвестор **после** HTTPS + live pay, не после «ещё фич».  
Нужен измеримый чеклист в API/UI.

## Сделано

1. `GET /api/v1/admin/h0-readiness` — score, blockers, checks (без секретов).  
2. `apiBaseGuard` + `API_BASE_GUARD` — блок localhost в staging builds.  
3. Home `IntegrationHonestyBadge` — chip H0 / API.  
4. Admin dashboard — строка H0.  
5. `docs/H0-STAGING-RUNBOOK-2026-07-19.md`.

## Проверка

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest -q tests/test_h0_readiness.py
cd apps/mobile && npx tsx lib/apiBaseGuard.test.ts
```
