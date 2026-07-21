# Audit wave-3 — встроено в develop (2026-07-21)

Продолжение `AUDIT-P0-P2-IMPLEMENTATION-2026-07-21.md` + wave-2.

## Зачем

Закрыть оставшиеся P0/P1 из аудита без «фейкового DONE»: OTP brute-force, honesty «Мой налог», fail-closed UX, multi-instance WS (opt-in), SecureStore dep.

## Изменения

| Область | Что | Эффект |
|---------|-----|--------|
| `otp_service` | 5 SMS / 10 мин; lock 15 мин после 5 bad verify | Анти-брутфорс / SMS-abuse |
| `auth_audit` | login/demo/refresh/bad OTP в AuditLog | Identity forensics |
| `User.moy_nalog_status` | enum-string + unlink API | UI не врёт «подключён» |
| BudgetPayments | фильтр `paid_unverified` | Видимость «оплачено без чека» |
| Scratchpad | chatInbox без `.catch(()=>[])` | Нет слепых дублей чатов |
| WS | `REDIS_URL` → publish channel | Готовность multi-instance |
| mobile | `expo-secure-store` | JWT не только в AsyncStorage |
| sqlite_compat | починен broken try/except | Dev SQLite schema снова валиден |

## Миграции

- `b2c3d4e5f6a7` — `users.moy_nalog_status`

## Тесты

```bash
cd backend && pytest tests/test_otp_rate_limit.py -q
```

## Не закрыто (ops) — см. wave-4

1. Split release develop→main
2. Live staging readiness report
3. Полный OAuth «Мой налог»
4. ~~Redis subscriber~~ → wave-4 `ws_redis_bridge`
5. Постоянный `@sentry/react-native` init в App (DSN wiring ready)
