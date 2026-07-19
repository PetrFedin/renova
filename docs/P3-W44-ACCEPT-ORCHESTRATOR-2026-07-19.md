# P3-W44 — AcceptOrchestrator + demo honesty

## Цель

Один каскад приёмки для mobile и portal; график не обходит WA; демо не врёт про реквизиты/интеграции.

## Сделано

| Пункт | Деталь |
|-------|--------|
| `accept_orchestrator.py` | `finalize_work_acceptance` + `emit_acceptance_side_effects` |
| WA + portal | оба вызывают orchestrator (act doc, payment, next stage, notify) |
| `AcceptancePassed` | всегда с `stage_id` → automation «Можно оплатить» |
| Schedule `accepted` | → `review`, **без** `customer_accepted_at` / auto-payment |
| Demo seed | `ContractorProfile.payment_requisites` (СБП) |
| Home | `IntegrationHonestyBadge` (ЮKassa / ФНС / Kontur\|in_app) |

## Тесты

`backend/tests/test_acceptance_canon.py` — 5 passed (incl. stage_id + schedule no-bypass).

## Next (W45)

Budget SoT · YuKassa staging live (ops keys) · portal branded pay · bank import confirm.
