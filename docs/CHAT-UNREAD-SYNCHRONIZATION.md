# Chat unread synchronization

**Дата:** 2026-07-21  
**Ветка:** `agent/chat-unread-synchronization`  
**PR:** Draft #29

## Источник истины

Мобильный store: `apps/mobile/lib/inboxSyncStore.ts`

```
totalUnread = sum(thread.unread_count) по неархивным чатам
```

Backend SoT: `GET /api/v1/chats/inbox` + `ChatThreadRead.last_read_at`.  
После успешного `POST .../read` authoritative: `thread_unread_count` + `total_unread_count` из ответа (локальная сумма не откатывает серверный total).

## Sync orchestrator

Один orchestrator в `inboxSyncStore`:

| Механизм | Правило |
|----------|---------|
| Inbox WebSocket | одно соединение на user (ref-count) |
| Fallback poll | один timer: 25s без WS / 60s при WS |
| Inflight reload | один на user scope; join только если тот же `localMutationRevision` + `reloadRequestSequence` |

Компоненты (`useChatUnread`, `useInboxTasks`, `ChatListView`) только:

- подписываются на store;
- вызывают `requestInboxSync({ reason })`;
- **не** создают собственные WS/polling.

Reasons: `initial | focus | manual | websocket_reconcile | offline_flush | foreground | mark_read_failure | project_change | invariant_reconcile`.

### Invalidation старых запросов

При начале mark-read:

1. `invalidateUnreadReloads()` → `localMutationRevision++`, `reloadRequestSequence++`;
2. optimistic `unread=0` для треда;
3. старые in-flight reload **не применяются** (`canApplyReload`);
4. **не** присоединяемся к pre-read inflight;
5. при успешных counters из POST — **без** полного reload.

Каждый reload помнит `{ requestSequence, userId, startedAtMutationRevision }`.

## Read lifecycle

Единственный backend endpoint изменения read-state:

`POST /api/v1/projects/{project_id}/chats/{thread_id}/read`

`GET .../chats/{thread_id}` — **чистый**: не вызывает `mark_thread_read`.

Клиент:

1. `loadMessages` только загружает и `setChat`;
2. `useFocusEffect` + `AppState`;
3. после render commit `useEffect` (gate `shouldMarkThreadReadAfterCommit`) → `markThreadRead`;
4. project id: route params → `inboxSyncStore.threads` → inbox API (не GET chat).

Mark-read **не** выполняется при ошибке загрузки, до commit, в background, на unfocused, на stale thread.

Открытый focused+foreground тред: входящее сообщение не поднимает badge; после reload сообщений — mark-read. Background / unfocused — unread растёт.

## Event dedup

`event_id` = UUID (не timestamp). Store хранит LRU последних ID. Дубликат: без unread bump, без второго reload/mark-read.

`chat_message_created` предпочтительно с counters; иначе один deduped reconcile.

## Цвета и UI

| Цвет | Значение |
|------|----------|
| Красный `ChatBadge` | только непрочитанные сообщения |
| Жёлтый `TaskBadge` | только задачи |

### UI locations

| Место | Что показывает | Цвет |
|-------|----------------|------|
| Нижняя «Сообщения» | global `totalUnread` | Красный |
| Кнопка «Ещё» | только `taskBadge` | Жёлтый |
| Строка «Входящие» в «Ещё» | Сообщения: N · Задачи: N | Красный / жёлтый |
| Список чатов | одна строка «N непрочитанных» / «В фильтре: X из Y» | Текст |
| Карточка чата | unread треда (+ a11y label) | Красный |

**Нет** отдельной верхней иконки сообщений (`OsHeaderChatButton` удалён).  
Сообщения **не** возвращаются на badge кнопки «Ещё».

## Error recovery

`markThreadRead` → `MarkReadResult`: `confirmed | reconciled | failed`.  
При ошибке: один force sync; если и он упал — флаг `markReadSyncFailed` и текст «Не удалось синхронизировать прочтение» (без Alert). Retry на focus/foreground.

## Тесты

```bash
npm run test:chat-unread
# включает store + gate + lifecycle contract

cd backend && .venv/bin/python -m pytest \
  tests/test_chat_mark_read_contract.py \
  tests/test_chat_mark_read_http.py -q
```

HTTP-тест покрывает: auth/ACL, unread до read, POST counters, GET без side-effect, идемпотентность, архив.

## Ручная приёмка (обязательна до Ready)

Двухсессионный smoke + evidence. PR остаётся **Draft**, пока не подтверждены критерии из PR description.
