# Устойчивая семантика бейджа «Ещё»

## Проблема (до фикса)

Один слот на кнопке «Ещё» показывал сначала непрочитанные сообщения (красный),
а после их прочтения — задачи (жёлтый). Число в том же месте меняло смысл.

## Модель

```ts
type NavigationBadges = {
  unreadMessages: number; // dock «Сообщения»
  dueTasks: number;       // dock «Календарь» / home fallback
  notifications: number;  // шапка «Ещё» (inbox tasks без чата)
};
```

| UI-элемент | Значение | Источник | Цвет | Условие показа |
|------------|----------|----------|------|----------------|
| Dock «Сообщения» | unreadMessages | inboxSyncStore / useChatUnread | danger | > 0 |
| Dock «Календарь» | dueTasks | useTodayTaskCount | warning | > 0 |
| Home (если нет calendar) | dueTasks | useTodayTaskCount | warning | > 0 |
| Шапка «Ещё» | notifications | inboxTaskBadge | warning | > 0 |
| Строка «Входящие» | messages + tasks раздельно | те же поля | danger / warning | chips с подписью |

Сообщения и задачи **не суммируются** в одно необъяснимое `count` для навигации.

## Инвариант

После `unreadMessages → 0` слот «Ещё» либо скрыт (если notifications=0), либо по-прежнему показывает **тот же** notifications — не бывший chat count.
