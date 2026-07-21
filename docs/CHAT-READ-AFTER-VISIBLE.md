# Mark-read only after thread is visible

## Правило

Чат отмечается прочитанным только когда:

```
canMarkRead =
  screenFocused &&
  appState === 'active' &&
  threadLoaded &&
  accessConfirmed &&
  latestMessagesRendered
```

и только на переходе `false → true`.

## Запрещено

- mark-read в `ChatListView.openThread` (только навигация);
- mark-read в `GET /chats/{id}` (загрузка ≠ прочтение).

## Серверный cursor

`POST .../read` принимает `{ "read_through_message_id": "..." }`.

- проверяет доступ к треду;
- курсор `last_read_at` = `created_at` сообщения (или последнего);
- курсор **монотонный** (не уменьшается);
- идемпотентен;
- не создаёт activity events.

## Ошибки

При ошибке mark-read тред остаётся видимым; store делает force resync; локальный unread не «залипает» на 0 без подтверждения сервера.
