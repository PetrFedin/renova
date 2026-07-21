# Audit wave-4 — встроено в develop (2026-07-21)

Продолжение wave-3 (`c555748` / `bd7b96b`).

## Зачем

Добить follow-up из аудита, которые ещё были кодом, а не ops: Redis **subscribe**, fail-closed на критичных silent `.catch`, честный Sentry wiring.

## Изменения

| Область | Что | Эффект |
|---------|-----|--------|
| `ws_redis_bridge` | PSUBSCRIBE `renova:ws:*` + `instance_id` envelope | Multi-instance WS без echo-loop |
| `main` lifespan | стартует bridge при `REDIS_URL` | Горизонтальное масштабирование API |
| ChatThreadView | inbox без `.catch(()=>[])` + `reportError` | Нет слепой потери project_id |
| OfflineSyncStatus | очередь/статус fail → сообщение + report | Нет «всё синхронизировано» при ошибке чтения |
| StageDetail | `stageBlocked` fail-closed `blocked:true` | Нельзя сдать этап при неизвестных deps |
| DocumentsHub / Control / PaymentBlock | reportError на load fail | Observability вместо swallow |
| `reportError` | `@sentry/react-native` → `sentry-expo` | DSN-ready без hard dep |
| poetry extra `ws` | optional `redis` | `poetry install -E ws` |

## Env

```bash
REDIS_URL=redis://127.0.0.1:6379/0
EXPO_PUBLIC_SENTRY_DSN=  # уже в .env.example
```

## Тесты

```bash
cd backend && .venv/bin/pytest tests/test_ws_redis_bridge.py -q --noconftest
# или PYTHONPATH=. .venv/bin/python -c "from app.services.ws_redis_bridge import pack_message; print(pack_message({'a':1}))"
```

## Не закрыто (ops) — см. wave-5

1. Split PR develop→main (исполнение) — `scripts/split-release-status.sh`
2. Live staging / h0:check:live
3. ~~OAuth scaffold~~ → wave-5; live credentials отдельно
4. ~~Sentry init wiring~~ → wave-5; native SDK install при DSN
5. ~~reportCatch sweep критичных~~ → wave-5
