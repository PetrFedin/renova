# Audit wave-5 — встроено в develop (2026-07-21)

Закрывает оставшиеся code-embed пункты wave-4 «Не закрыто».

## Изменения

| Область | Что | Эффект |
|---------|-----|--------|
| `sentryInit` + `_layout` | init при `EXPO_PUBLIC_SENTRY_DSN` | Observability staging/prod |
| `reportCatch` | helper для `.catch(reportCatch(scope))` | Массовый отказ от silent swallow |
| Sweep | chat/unread, buckets, bus, context, widgets, stage, acceptance, analytics, works, payments, job lead | Ошибки видны в log/Sentry |
| `moy_nalog_oauth` | start/callback + status machine | Honesty OAuth; `connected` только после token exchange |
| Profile UI | «Авторизовать OAuth» + «флаг без OAuth» | Пользователь видит разницу |
| Split release | pin + `scripts/split-release-status.sh` | Подготовка develop→main |

## Env

```bash
EXPO_PUBLIC_SENTRY_DSN=
MOY_NALOG_CLIENT_ID=
MOY_NALOG_CLIENT_SECRET=
MOY_NALOG_TOKEN_URL=
MOY_NALOG_REDIRECT_URI=
```

## Тесты

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_moy_nalog_oauth.py tests/test_ws_redis_bridge.py -q --noconftest
npx tsx apps/mobile/lib/failClosed.w144.test.ts
npx tsx apps/mobile/lib/oauthScaffold.w145.test.ts
```

## Осталось (только ops / credentials) — см. wave-6 matrix

1. Split PR slices develop→main
2. Live `h0:check:live` / staging HTTPS
3. Реальные ФНС OAuth credentials
4. Native Sentry SDK при DSN
5. ~~silent catch sweep~~ → wave-6
