# Wave X — чеклист по аудиту 2026-07-31

Источник: `FULL-PROJECT-AUDIT-2026-07-31.md`.  
Цель: закрыть code-P0 trust до ops H0 (секреты — отдельно, руками).

## P0 — код (trust)

- [ ] `backend/app/api/v1/portal.py`: `_require_portal_scope(claims, "accept_stage")` на approve/reject CO
- [ ] `apps/mobile/app/portal.tsx`: CO UI только если `canAcceptPortal`
- [ ] Тест: pay-only token → 403 на CO
- [ ] `ActionConfirmSheet.tsx`: destructive / «Отклонить» → danger, не primary fill
- [ ] `StageContextSummary.tsx`: «К оплате» → `budgetTabRoute(..., 'payments', { stageId })`
- [ ] `WorkOrderDetailScreen.tsx`: `transition('paid')`, затем (опц.) nav в бюджет
- [ ] `portal.tsx`: pre-confirm на sign; убрать Alert на happy-path
- [ ] Demo YuKassa: amount в webhook body; fail → не возвращать `succeeded`
- [ ] Staging/prod: hard-fail `ALLOW_DEMO_SEED` / demo auth (как header auth)
- [ ] Webhook money mismatch → 4xx + alert, не `{ok:true, handled:false}`

## P1 — silent / связи / money UX

- [ ] `OsRoomsScreen`: LoadError + retry вместо noop
- [ ] Approvals / materials: UI на network/403 fail (не silent catch)
- [ ] `StageDetailLinks` + `RoomDetailScreen`: materials / payments / approvals / docs / этапы
- [ ] `PaymentDetailSheet`: 1 primary CTA + sticky confirm
- [ ] Sticky DecisionFooter на approvals / portal cards / acceptance
- [ ] Confirm на manual expense / create payment / edit amount
- [ ] Stage review: CTA «К приёмке» из payment hint
- [ ] Reject кнопки: `dangerOutline` паритет

## P0 — ops (вне PR кода)

- [ ] Реальный `EXPO_PUBLIC_API_URL` в `eas.json` (не `api-staging.example.com`)
- [ ] `PUBLIC_BASE_URL` HTTPS staging
- [ ] YuKassa keys + `demo_allowed=false` на staging
- [ ] `npm run h0:check:strict` + `h0:check:live` PASS
- [ ] Postgres staging; Pro test accounts
- [ ] Rebase/merge ветки на актуальный `main` (−195)

## CI / регрессия

- [ ] Добавить `npm run mobile:test` (или Clarity A–W) в CI
- [ ] Portal E2E: accept→pay (не ожидать вечный `read_only: true`)
- [ ] Clarity Wave X тест-файл на новые контракты

## DoD волны

15-мин путь без trust-ловушек: смета → lock → accept → pay (honest mode) → акт → portal; pay-only не двигает CO; «К оплате» открывает оплаты; WO paid меняет статус; destructive не primary.
