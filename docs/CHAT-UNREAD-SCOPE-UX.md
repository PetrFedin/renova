# Unread scope UX

Каждый счётчик имеет явный `UnreadScope`:

```ts
type UnreadScope =
  | { type: 'global' }
  | { type: 'project'; projectId: string }
  | { type: 'filter'; filterId: string }
  | { type: 'thread'; threadId: string };
```

Селектор: `selectUnreadCount(scope, source)` / `selectChatUnread(scope)`.
Голый `getUnread()` запрещён.

## Где что показывается

| Место | Scope | Подпись |
|-------|-------|---------|
| Dock / More chat badge | `global` | «во всех чатах» |
| Баннер списка | local + global | «В выбранном объекте: 3 из 8» |
| Tab Чаты/Архив | текущий filter | «в фильтре N» / «всего N» |
| Карточка треда | `thread` | только этот тред |

Смена фильтра **не** меняет global badge.

## Данные

Local totals считаются только из **полного** inbox snapshot (`threadsComplete: true`).
Paginated page → `reliable: false` (loading/stale), не сумма страницы.

## Тесты

```bash
npm run test:unread-scope
```
