# H0 Staging Runbook — до демо инвестору (2026-07-19)

Код критического пути (W44–W52) готов. **Без этого runbook пилот = ложное доверие.**

## Definition of Ready (investor demo)

| # | Check | Как |
|---|-------|-----|
| 1 | `ENVIRONMENT=staging` | сервер API |
| 2 | `PUBLIC_BASE_URL=https://…` | не localhost |
| 3 | `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET` | live checkout |
| 4 | Demo pay **off** | `demo_allowed=false` на staging |
| 5 | TestFlight / APK с `EXPO_PUBLIC_API_URL=https://…` | `EXPO_PUBLIC_APP_ENV=staging` |
| 6 | 1 тестовая оплата + webhook | Pro или stage payment |
| 7 | Portal: реквизиты исполнителя живые | не hardcode |

## Проверка в продукте

```bash
# API
curl -H "X-User-Id: <contractor>" https://API/api/v1/admin/h0-readiness
# ready_for_investor_demo: true
```

В приложении: Home chips **H0: ready** / Admin → `H0 investor: READY`.

## Клиентский guard

При `EXPO_PUBLIC_APP_ENV=staging|production` и localhost API — `API_BASE_GUARD.blocked` + chip «API: localhost (блок)».

## Что НЕ делать

- Не показывать инвестору `npm run` на localhost.
- Не включать demo YuKassa на staging «чтобы красиво».
- Не обещать WA Business / Kontur live без ключей.

## После H0 → H1

Trial Pro (W49) → 3 paid pilots → MRR > 0.
