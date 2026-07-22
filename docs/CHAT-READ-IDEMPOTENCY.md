# Chat mark-read idempotency

## Dependency map (до)

| Источник | Действие |
|----------|----------|
| ChatListView.openThread | ~~markChatReadAndSync~~ (удалено в after-visible) |
| ChatThreadView canMarkRead | mark → syncAfterRead → markChatReadAndSync → API + **full reload** |
| ChatListView.reload | reloadStore **и** reloadUnread (оба → reloadInboxSync) |
| ChatListView WS bus | reload + reloadUnread |
| useChatUnread WS | reloadInboxSync |
| useInboxTasks WS/bus/focus | ещё reloadInboxSync |

## После

Единый action:

```ts
markThreadRead({ threadId, throughMessageId, throughCreatedAt, source })
```

- `Map<threadId, Promise>` — in-flight dedupe
- `confirmedRead` — skip same / skip stale cursor
- успех → точечный patch unread (без полного reload)
- ошибка → один `reloadInboxSync(force)`

Список чатов: один `reloadStore()` (= reloadInboxSync); без парного `reloadUnread` и без дубля WS bus listener.

## Dev diagnostics

`getMarkReadDiagSnapshot()` / `recordMarkReadDiag` — threadId, source, outcome; без текста сообщений.
