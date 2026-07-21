# W83 — интеграции без платежей live (2026-07-20)

Продолжение W82: **смета lock + оплаты + согласования** → `syncProjectSideEffects` → inbox/home.

## Канон

Тот же helper: `apps/mobile/lib/projectDataBus.ts` → `reloadInboxSync` + `notifyProjectDataChanged`.

## Где подключено

| Зона | Мутации |
|------|---------|
| CustomerEstimateView | lock / reject propose |
| ContractorEstimateView | propose / withdraw |
| CreatePaymentForm | createPayment |
| PaymentDetailSheet | confirmPayment, YuKassa demo |
| ChatThreadView | invoiceFromChat |
| OsSelections / OsRooms | approve selection / room change |
| MaterialPickList / DetailSheet | submit / approve / create pick |
| OsMaterialsScreen | createPurchase |

## Зачем

После фиксации сметы и выставления/подтверждения счёта «Входящие» и nextAction на главной обновляются сразу — golden path usable без remount.

## Тест

`npx tsx apps/mobile/lib/projectDataBus.w82.test.ts` (шина без регрессий).

## Вне скоупа

H0: live YuKassa/Kontur, HTTPS staging, TestFlight.
