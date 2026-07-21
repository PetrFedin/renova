# W80 — синхрон бейджа непрочитанных (шапка «Ещё» ↔ dock «Сообщения»)

## Проблема
Сверху на «Ещё» была цифра задач inbox; внизу на «Сообщениях» бейджа не было (или он не совпадал). При прочтении чата ожидалась синхронизация обоих.

## Решение
- Один SoT: `inboxSyncStore.chatCount` через `useChatUnread` / `useInboxTasks.chatUnread`.
- `resolveHeaderMoreBadge`: если есть непрочитанные — **красный** бейдж с `chatUnread` (то же число, что dock).
- Dock «Сообщения»: `dockChatBadgeCount(chatUnread)` + увеличен `iconWrap`, чтобы бейдж не обрезался.
- Задачи inbox остаются янтарными **только** если чата нет, и всегда в пункте «Входящие».
- `markChatReadAndSync` / открытие треда → notify store → оба бейджа обновляются вместе.

## Тест
`headerChatBadges.w80.test.ts` — инвариант header.count === dock.count при chat > 0.
