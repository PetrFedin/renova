# Chat unread synchronization

**Дата:** 2026-07-21  
**Ветка:** `agent/chat-unread-synchronization`

## Источник истины

Мобильный store: `apps/mobile/lib/inboxSyncStore.ts`

```
totalUnread = sum(thread.unread_count) по всем неархивным чатам пользователя
```

Backend SoT при resync: `GET /api/v1/chats/inbox` + `ChatThreadRead.last_read_at` per (user, thread).

Не создаём параллельный unread context.

## Что входит / не входит

| Входит в totalUnread | Не входит |
|----------------------|-----------|
| Неархивные чаты всех доступных проектов пользователя | Архивные чаты |
| Сообщения других участников после last_read_at | Свои сообщения, system |

Смена **объекта** не сбрасывает totalUnread.  
Смена **пользователя** очищает threads/total сразу.

## Цвета

| Цвет | Значение |
|------|----------|
| Красный | только непрочитанные сообщения |
| Жёлтый / янтарный | только задачи «Входящие» |

Запрещено: один badge-слот, который сначала показывает чат, а после прочтения — задачи.

## Read lifecycle

Чат считается прочитанным только когда:

1. экран треда в focus;
2. `getChat` / загрузка сообщений успешна;
3. сообщения отображены;
4. приложение в **foreground** (`AppState === 'active'`).

`ChatListView.openThread` **не** вызывает mark-read.

Единственный клиентский путь: `ChatThreadView` → `markChatReadAndSync`.

Backend: `POST .../read` идемпотентен; `GET .../chats/{id}` также обновляет cursor (совместимость).

## Optimistic update

1. `thread.unread_count = 0` в store  
2. `totalUnread = sum(threads)`  
3. notify подписчиков (header + dock + list)  
4. `POST /read`  
5. при ошибке — force `reloadInboxSync`  
6. не вычитаем `total -= knownUnread` вручную  

## WebSocket

`/ws/inbox/{userId}` — одно соединение (ref-count).

Payload (предпочтительно):

```json
{
  "type": "chat_read" | "chat_message_created",
  "thread_id": "...",
  "project_id": "...",
  "thread_unread_count": 0,
  "total_unread_count": 2,
  "event_id": "...",
  "occurred_at": "..."
}
```

`chat_read` с счётчиками применяется локально без лишнего reload.  
Иначе — один deduplicated `reloadInboxSync`.

Polling: 25s без WS, 60s при WS.

## Фильтры и архив

Глобальные header/dock **не** зависят от фильтра объектов.  
На экране чатов при фильтре: `В фильтре: X из Y`.

Архив: thread badge локально допустим; в global — нет.

## API

`POST /api/v1/projects/{pid}/chats/{tid}/read` →

```json
{
  "ok": true,
  "thread_id": "...",
  "thread_unread_count": 0,
  "total_unread_count": 2,
  "read_at": "..."
}
```

## UI locations

| Место | Что показывает | Цвет | Источник |
|-------|----------------|------|----------|
| Верхняя иконка сообщений | Все непрочитанные | Красный | `inboxSyncStore` totalUnread |
| Нижняя «Сообщения» | Все непрочитанные | Красный | то же |
| Экран чатов | Все / в фильтре | Текст | то же + filter sum |
| Карточка чата | unread треда | Красный | `thread.unread_count` |
| Кнопка «Ещё» | Задачи | Жёлтый | `taskBadge` |
| Строка «Входящие» | Сообщения и задачи раздельно | Красный / жёлтый | selectors |

## Тесты

- `npm run test:chat-unread`
- `pytest backend/tests/test_chat_mark_read_contract.py`
