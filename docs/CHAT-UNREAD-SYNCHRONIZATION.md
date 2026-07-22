# Chat unread synchronization

**Ветка:** `agent/chat-unread-synchronization`  
**PR:** Draft #29

## Итоговая архитектура

PR объединяет проверенный chat-stack: read-after-visible, idempotent mark-read, atomic unread snapshot, единый orchestrator, active-thread policy, явные unread scopes и foreground guard.

### UI-инварианты

- нижняя кнопка «Сообщения» показывает только global unread сообщений;
- кнопка «Ещё» показывает только жёлтый task badge;
- строка «Входящие» показывает два подписанных счётчика: `Сообщения: N` и `Задачи: N`;
- красный `ChatBadge` используется только для сообщений;
- жёлтый `TaskBadge` используется только для задач;
- отдельной верхней кнопки сообщений нет.

### Read lifecycle

Чат отмечается прочитанным только после одновременного выполнения условий:

- экран focused;
- приложение foreground и web-документ видим;
- доступ к треду подтверждён;
- актуальный transcript загружен;
- сообщения прошли render commit;
- поверх ленты нет блокирующего overlay.

`POST /read` принимает `read_through_message_id`. GET чата не изменяет read-state. Mark-read дедуплицируется по треду и cursor; после ошибки выполняется один reconciliation.

### Synchronization

- один chat sync orchestrator;
- context key включает пользователя, роль и объект;
- старые и отменённые ответы не применяются;
- inbox/thread WS коалесцируются;
- fallback polling включается только при разрыве WS;
- atomic inbox snapshot содержит revision, threads и global total;
- stale revisions игнорируются;
- logout очищает store и transport.

### Active thread

Входящее сообщение в реально видимом треде сначала попадает в transcript, затем read cursor подтверждается после sync/render. Background, unfocused screen и modal overlay не считаются чтением.

## Проверки

Специализированные скрипты chat-stack находятся в `package.json`; backend покрывает read-after-visible и atomic unread snapshot. GitHub CI должен быть зелёным после интеграционного merge.

## Ручная приёмка

PR остаётся Draft до двухсессионного smoke test с записью экрана: 3 → 0 после открытия, background 0 → 1, foreground после отображения → 0, WS off → корректный polling, deep link/push/search/inbox/offline/reconnect.
