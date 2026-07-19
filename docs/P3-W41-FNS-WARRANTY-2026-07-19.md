# P3-W41 — FNS live verify · warranty list · moy-nalog honesty

## Сделано

| Task | Изменение |
|------|-----------|
| FNS verify | Auth Basic (`FNS_RECEIPT_*`), URL builder, mode live/demo/offline |
| FNS health | `GET /api/v1/fns/health` + release-health.integrations.fns |
| Re-verify | `POST …/receipts/{id}/reverify` + кнопка «Проверить ФНС» |
| Warranty | `GET` list + `POST …/close` + QC deep link из Document Center |
| Мой налог | Staging/prod без `MOY_NALOG_ENABLED` → 501 (не silent demo) |

## Env

```bash
FNS_RECEIPT_LOGIN=
FNS_RECEIPT_PASSWORD=
MOY_NALOG_ENABLED=false
```

## DoD
- staging без auth: чек `verified=false`, `mode=offline` (не demo true)
- health `live_verify_ready` только при auth + staging/prod
- warranty list фильтрует `[Гарантия]`

## Не в этом PR
- Реальный OAuth «Мой налог»
- YuKassa keys в staging (ops)
