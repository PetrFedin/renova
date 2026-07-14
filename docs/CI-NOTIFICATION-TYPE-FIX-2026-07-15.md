# CI fix: NotificationType `stage_started` (2026-07-15)

**Репозиторий:** https://github.com/PetrFedin/renova  
**Ветка:** `develop`  
**Следом за:** `edb91d0` (uvicorn CI e2e)

## Симптом (GitHub Actions e2e)

После фикса `poetry run uvicorn` e2e падал на приёмке этапа:

```text
ValueError: 'stage_started' is not a valid NotificationType
```

Стек: `work_acceptances.py` (notify после accept → следующий этап) → `notification_service.notify` → `NotificationType(...)`.

Локально часто «зелёно»: demo-данные / ветка без `next_stage` / кеш БД не всегда доходят до этого notify. На **чистом SQLite в CI** путь срабатывает стабильно.

## Корневая причина

В callers уже использовались строки вне enum:

| Caller string | Было в enum? |
|---------------|--------------|
| `stage_started` | ❌ |
| `stage_start` | ❌ (синоним) |
| `material` | ❌ (есть `materials`) |
| `budget` | ❌ (есть `budget_alert`) |
| `approval`, `issue`, `deadline`, `waste_reminder`, `room_created` | ❌ |

`NotificationType(notification_type)` бросал `ValueError` → 500 на accept → e2e FAIL.

## Исправление

1. **`backend/app/models/entities.py`** — расширен `NotificationType`:
   - `stage_started`, `room_created`, `approval`, `issue`, `deadline`, `waste_reminder`, `document`, `other`
2. **`backend/app/services/notification_service.py`**:
   - `resolve_notification_type()` + aliases (`material`→`materials`, `budget`→`budget_alert`, `stage_start`→`stage_started`)
   - неизвестное → `other` (не валит бизнес-операцию)
3. **`backend/tests/test_notification_types.py`** — регрессия на aliases и fallback

## Проверка

```bash
cd backend && poetry run pytest tests/test_notification_types.py -q
# после API :8100
bash scripts/e2e-smoke.sh
```

## Связь с релизом

Блокер чистого merge **PR #2** (`develop` → `main`) / тег `v0.2.0`. Без этого CI e2e остаётся красным после uvicorn-фикса.
