# W82 — интеграции без платежей (2026-07-20)

Единый side-effect после мутаций golden path: **inbox + home nextAction** без remount.

## Канон

`syncProjectSideEffects({ user, project, role? })` в `apps/mobile/lib/projectDataBus.ts`:

1. `reloadInboxSync` (бейджи «Входящие» / «Ещё» / nextAction)
2. `notifyProjectDataChanged` (home / подписчики)

## Где вызывается

| Экран | Мутации |
|-------|---------|
| WorkAcceptanceScreen | request / accept / return |
| EstimateChangesLayer | approve / reject ДО |
| DocumentsHub | sign in_app+Kontur, warranty create/close, closeout |
| QualityControlScreen | warranty create/close, escalate, close issue |
| UnifiedScheduleView | schedule submit/confirm/reject (через helper) |
| ChatThreadView | confirm message |

## Тест

```bash
npx tsx apps/mobile/lib/projectDataBus.w82.test.ts
```

## Вне скоупа

H0: HTTPS `PUBLIC_BASE_URL`, YuKassa/Kontur live secrets, TestFlight.
