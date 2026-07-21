# Политика: unread в архивных чатах

## Выбранная политика (рекомендуемая)

1. **Архив** — организация списка чатов пользователя, **не** отключение уведомлений и **не** mark-read.
2. **Новое входящее сообщение** (для получателя), атомарно в одной транзакции с созданием сообщения:
   - снимает `is_archived` / `archived_at`;
   - увеличивает unread (read cursor не двигается);
   - тред возвращается в основной список;
   - входит в **global unread** (dock / header).
3. **`muted_until`** хранится отдельно от archive. Mute подавляет push, но не unread и не список.
4. **Архивация не отмечает сообщения прочитанными** — `last_read_at` не меняется.
5. **Leftover unread в архиве** допустим до первого нового входящего **или** ручного прочтения / восстановления. Пока тред в архиве, его unread **не** входит в global badge; в папке «Архив» показывается и объясняется.

## Поля (per-user `chat_thread_reads`)

| Поле | Смысл |
|------|--------|
| `last_read_at` | Read cursor |
| `is_archived` / `archived_at` | Папка архива |
| `muted_until` | Тишина уведомлений до момента |

## Global total

`count_unread_*` / `sumActiveChatUnread` = сумма unread по тредам с `!is_archived`.

После auto-unarchive тред учитывается сразу (и на сервере, и в store после WS `unarchived`).

## UI

- Вкладка «Архив»: поясняющий баннер + локальный счётчик unread архива.
- Badge «Без звука» отдельно от archive.
- Действие «В архив» → только `is_archived` (offline queue тоже).
- Восстановление / новое сообщение → один тред в «Чаты», без дубликата (`dedupeThreadsById`).

## Гонки

| Сценарий | Поведение |
|----------|-----------|
| Archive + одновременное сообщение | Сообщение коммитится вместе с unarchive получателя |
| Два устройства | WS `unarchived` + reload; store dedupe по id |
| Повторный WS | Unarchive идемпотентен; unread bump только при `unarchived` |
| Ручное восстановление | `is_archived=false`, unread без изменений |
| Offline archive | Очередь PATCH state; не вызывает mark-read |
| Mute + archive | Сообщение снимает archive, mute остаётся, push не шлётся |

## Тесты

```bash
npm run test:archived-chat-unread
```
