# Chat sync orchestrator

Единый слой синхронизации чатов: `apps/mobile/lib/chatSync/`.

## API

```ts
requestChatSync({
  scope: 'all' | 'thread',
  threadId?: string,
  reason: 'initial' | 'focus' | 'websocket' | 'manual' | 'offline_flush'
        | 'project_change' | 'app_foreground' | 'reconnect' | 'poll',
  priority?: 'high' | 'normal' | 'low',
});
```

Context key: `${userId}:${role}:${projectId}` — ответ применяется только при совпадении.

## Поведение

| Механизм | Было | Стало |
|----------|------|--------|
| Focus / manual / project / offline | прямой `reloadInboxSync` | `requestChatSync` (coalesce) |
| Inbox WebSocket | каждый event → reload | debounce 150ms → sync |
| Inbox polling | setInterval в store + list | orchestrator backoff; при WS — 60s |
| Thread WebSocket | прямой reload | `scope:'thread'` + debounce |
| Offline flush | несколько reload | один `offline_flush` high |

## Правила

- Coalesce одинаковых `${scope}:${threadId}:${contextKey}`
- High priority отменяет более слабый in-flight (`AbortController`)
- Sequence + context key: старый ответ не применяется
- Logout / unmount → cancel + skip
- Reconnect WS → один reconciliation (`reason: reconnect`)
- Web (BroadcastChannel): invalidate соседних вкладок

## Метрики (без PII)

`getChatSyncMetrics()` → syncRequests, coalescedRequests, cancelledRequests, wsReconnects, reconciliationFailures, appliedResponses, droppedStaleResponses

## Тесты

```bash
npm run test:chat-sync
```

Fake timers + mock transport: 10 WS, focus+WS, project switch, logout, reconnect, offline flush, poll fallback, stale cancel, unmount, dual-tab broadcast.
