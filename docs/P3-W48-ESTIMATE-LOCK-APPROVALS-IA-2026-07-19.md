# P3-W48 — Lock сметы заказчиком + Approvals в «Ещё» + IA registry (2026-07-19)

## Зачем

P0.4 плана инвестора: без **согласованной** базовой сметы нет договора и доверия на демо.  
P2.7: меню «Ещё» должно вести в живые центры (документы / согласования / входящие), не в WIP-дубли.

## Что сделано

1. **API `POST …/estimate/lock`** — доступен **customer** и **contractor**; уведомление уходит контрагенту.
2. **CustomerEstimateView / EstimateSummaryLayer** — статус «черновик / согласована» + CTA «Согласовать и зафиксировать смету» → договор в Документах.
3. **`routeRegistry`**: маршрут `approvals` в `visibility: more` (GA); `documents`/`portal` → GA; `userFacingRouteIds()` для аудита ≤40.
4. **`approvals.tsx`**: импорт `Alert` (баг после approve CO).
5. Тест: `test_customer_can_lock_estimate` + smoke `routeRegistry.test.ts`.

## Не в этой волне (ops / следующие)

- H0 YuKassa staging keys + TestFlight HTTPS  
- P2.4 Procurement hub UX deep  
- P2.5 AI weekly digest (Ollama)  
- Kontur/FNS live credentials  

## Проверка

```bash
cd backend && .venv/bin/pytest -q tests/test_estimate_lock.py
cd apps/mobile && npx tsx lib/routeRegistry.test.ts
```
