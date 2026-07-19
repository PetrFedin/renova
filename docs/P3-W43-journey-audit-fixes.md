# P3-W43 — Journey audit: единая логика приёмки / оплат / гарантии

## Контекст

Полный разбор путей заказчик × исполнитель выявил тупики и рассинхрон событий.
Волна W43 закрывает **критичные** разрывы (≥9/10), не весь backlog.

## Исправлено в коде

| Проблема | Фикс |
|----------|------|
| Repair→Приёмка = Redirect (ControlView orphan) | `OsControlScreen` снова монтирует `CustomerControlView` / `ContractorControlView` |
| WA emit `AcceptanceAccepted`, automation ждёт `AcceptancePassed` | WA/portal → `AcceptancePassed`; automation принимает оба |
| in_app подпись оставляла doc `draft` | после полного sign → `active` |
| CreatePaymentForm: advance/final → 403 | только `stage` / `material` + честный hint |
| Payment «в чате» — ложь | текст → «во Входящих»; deep-link приёмки → Repair?tab=control |
| Warranty → QC без issueId; заказчик в contractor UI | contractor: QC?issueId=; customer: Repair→Приёмка; QC читает `issueId` |

## Остаётся (W44+)

- Единый accept orchestrator (WA / schedule / portal)
- Bank import → confirm payment
- Единый writer `budget_planned`
- UI work schedule submit/confirm
- Approvals в More / lock base estimate для customer

## Канон цепочки (целевой)

`object → estimate → schedule → acceptance → payment → docs → warranty/closeout`
