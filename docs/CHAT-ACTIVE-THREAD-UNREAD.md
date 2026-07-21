# Active thread unread (no flicker)

## Проблема

Inbox sync поднимал unread открытого треда → badge 0→1, затем mark-read → 0.

## Политика: Вариант A

Любое сообщение в **открытом foreground-треде с отрисованной лентой** считается прочитанным.

Не требуется попадание в viewport (Variant B).

Условия (`activeThreadContext`):

- `threadId` совпадает
- `screenFocused`
- `appForeground` (AppState active)
- `threadLoaded` + `accessConfirmed`
- `messagesVisible` — лента painted (rAF) и нет overlay/modal поверх чата

Только `threadId` **недостаточно**.

## Транзакция

1. Нормализация WS по `messageId` (dedupe)
2. В одной store-операции: messages (UI) + unread bump/suppress + при необходимости mark-read cursor
3. Inbox snapshot: `clampSnapshotForActiveRead` обнуляет unread активного треда до notify

## Файлы

- `lib/domain/activeThreadContext.ts`
- `lib/domain/incomingChatMessage.ts`
- `lib/inboxSyncStore.ts` — context, ingest, clamp
- `ChatThreadView` — публикует context, локальный append без сброса canMark

## Тесты

```bash
npm run test:active-thread-unread
```
