# P3-W39 — Routes &lt;50 · SMTP · 1С XML

## Сделано

| Task | Изменение |
|------|-----------|
| IA routes | Expo route-файлы **69 → 46** (excl. `_screens`/`_stack`) |
| Root `[slug]` | Legacy redirects + secondary stack (guide/reports/…) |
| Contractor `[tool]` | admin / dashboard / audit / subscription / team-qr / articles |
| Wizard/onboarding | `[step]` + `_screens` |
| SMTP | `SMTP_HOST` → real smtplib; иначе log stub |
| 1С XML | `GET …/export/1c-payments.xml` + Document Center |

## DoD
- Deep links `/notifications`, `/finance-center`, `/work-schedule`, `/design` работают через `[slug]`
- Пути `/wizard/type`, `/onboarding/role`, `/(contractor)/subscription` без изменений
- Без SMTP — email только в лог; с SMTP — send + fallback log on error
- XML = `RenovaExchange` (платежи + change orders)

## Env

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=ops@renova.local
SMTP_USE_TLS=true
```

## Не в этом PR
- CommerceML full / прямой API 1С
- YuKassa staging keys (ops)
