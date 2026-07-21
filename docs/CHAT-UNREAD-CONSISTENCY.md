# Chat unread consistency

Один источник истины: **атомарный snapshot** `GET /api/v1/chats/inbox`.

```json
{
  "revision": 12345,
  "total_unread_messages": 8,
  "threads": [{ "id": "...", "unread_count": 3, "is_archived": false }],
  "scope": {
    "include_archived": false,
    "include_muted": false,
    "unit": "messages"
  }
}
```

Frontend (`inboxSyncStore`) применяет snapshot **целиком**. Независимый `unread-total` без threads не обновляет badge.

## Scope (зафиксировано)

| Область | В global `total_unread_messages`? |
|---------|-----------------------------------|
| Активные треды | да |
| Архивные треды | **нет** (unread на карточке архива может остаться, но не в badge) |
| Muted | N/A (в продукте нет) |
| Закрытые | N/A (в продукте нет) |
| Единица | **сообщения** (`unread_count`), не число тредов |
| Фильтр проекта (UI) | не меняет global; `sumVisible ≤ total` |

## Revision

- Backend: `revision` = ms timestamp на момент сборки snapshot.
- Локальный patch (read / archive): `revision = max(now, current + 1)`, total пересчитывается в том же action.
- Успешный GET inbox: `force` apply (SoT сети); out-of-order отсекает `loadGeneration`.
- Без `force`: `incoming.revision < current` → reject, флаг `stale`.

## Ошибки

- Ошибка списка → **не** подменяем только total; ставим `stale` / `failed`.
- UI: баннер «Счётчик мог устареть».

## Invariant (dev/test)

`sum(active thread unread) === total`  
`sum(visible filtered) ≤ total`

Предупреждение без PII: `[chat-unread-invariant] { revision, sumActive, total, threadCount }`.

## Тесты

```bash
npm run test:chat-unread-consistency
cd backend && .venv/bin/python -m pytest tests/test_chat_unread_snapshot.py -q
```

Покрыто: full snapshot, partial patch, archive/unarchive, new/remove thread, read, stale revision, force network, project filter, pagination page ≤ total, legacy array.
