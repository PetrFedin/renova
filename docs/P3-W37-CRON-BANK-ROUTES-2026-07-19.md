# P3-W37 — Cron hardening · bank import · route consolidation

## Сделано

| Task | Изменение |
|------|-----------|
| P4.2a Cron | Metrics + ALERT after 3 fails; `GET/POST /api/v1/automation/worker` |
| P4.1b Bank import | `POST …/import/bank-statement` — CSV → матч платежей (±1₽, ±3д) |
| IA routes | Legacy tabs → `[legacyTab]` catch-all; **87 → 69** route files |
| Waste notify | Deep link → calendar (не legacy estimate) |

## Document Center
- «Импорт выписки» (web: paste CSV)

## DoD
- Worker status `healthy` при <3 consecutive failures
- CSV parse: заголовок или `дата;сумма;назначение`
- Deep links `/(customer)/(tabs)/works` и т.п. редиректятся через catch-all

## Не в этом PR
- SMTP real email
- Ollama digest
- route files &lt;50 (нужен ещё один проход по stack orphans)
