# W88 — интеграции без live-оплат (2026-07-20)

Склейка шин **projectDataBus ↔ inboxSyncStore** + бюджет/профиль/черновики/Pro.

## Архитектура

```
мутация UI → syncProjectSideEffects / runWithProjectSideEffects
                 ├─ reloadInboxSync  → badges (subscribeInboxSync)
                 └─ notifyProjectDataChanged
                        ├─ OsHomeScreen.load()
                        └─ useInboxTasks.reload()   ← W88 bridge
```

Даже если caller вызвал только `notifyProjectDataChanged`, бейджи «Входящие»/«Ещё» обновятся через подписку в `useInboxTasks`.

## Где ещё подключено

| Зона | Мутации |
|------|---------|
| useInboxTasks | subscribeProjectDataChanged → reload |
| updateProjectProfile | patch профиля/адреса/бюджета |
| useCustomerBudget / migrate | customer_budget |
| ScratchpadScreen | promote → work / expense |
| subscription | startProTrial / checkoutPro |

## Тест

`npx tsx apps/mobile/lib/projectDataBus.w88.test.ts`

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
