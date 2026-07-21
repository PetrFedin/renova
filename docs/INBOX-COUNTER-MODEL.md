# Inbox counter model

## Проблема

Раньше `inboxBadge = tasks + unreadMessages` смешивал разные единицы (например 19 = 17 сообщений + 2 задачи).

## SoT

`InboxCounters` в `apps/mobile/lib/domain/inboxCounters.ts`, хранится в `inboxSyncStore`.

| Поле | Семантика |
|------|-----------|
| `unreadMessages` | число непрочитанных **сообщений**, не тредов |
| `activeTasks` | этапы/работы/приёмка/offline и пр. |
| `pendingApprovals` | согласования (approval, estimate, material, …) |
| `paymentActions` | платежи, требующие действия |
| `qualityActions` | замечания / гарантия |
| `totalActionGroups` | число категорий с активностью (0–5), не сумма сущностей |

## UI

Экран «Входящие» и меню показывают **подписанные** строки по категориям.
`inboxAttentionBadge` deprecated и не используется в UI.

## API

`GET /api/v1/chats/unread-total` возвращает:

```json
{
  "count": 17,
  "unread_messages": 17,
  "active_tasks": 0,
  "pending_approvals": 0,
  "payment_actions": 0,
  "quality_actions": 0,
  "total_action_groups": 1
}
```

`count` = deprecated alias `unread_messages`. Action-поля на этом global endpoint = 0;
полные action-счётчики считает клиент из строк inbox текущего проекта.

## Двойной учёт

`buildInboxItems` не добавляет material-строку, если уже есть approval того же типа.
Каждая строка попадает ровно в одну категорию `InboxCounters`.
