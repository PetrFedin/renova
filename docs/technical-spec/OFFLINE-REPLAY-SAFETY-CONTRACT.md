# RENOVA — Offline Replay Safety Contract

Этот контракт определяет, какие client mutation разрешено автоматически повторять после timeout, response loss, 429 или 5xx.

## Базовое правило

`offline queue != retry every failed request`.

Команда может попасть в durable queue только если **до первого network attempt** у неё есть доказуемая replay semantics одного из двух типов:

1. **Request-ledger command** — стабильный `client_request_id` / idempotency key, а backend атомарно фиксирует business entity/state + request ledger + обязательные outbox effects.
2. **Explicit state assignment** — повтор точно того же тела устанавливает то же конечное состояние и не создаёт второй side effect. Role/state guards выполняются и на same-state replay.

Во всех остальных случаях mutation работает **fresh-only** до отдельной квалификации.

## Ambiguous transport failures

Автоматический enqueue допустим только для уже replay-safe команды при:

- network failure / transport `status=0`;
- timeout;
- HTTP 429;
- HTTP 5xx;
- malformed 2xx response, когда сервер мог уже зафиксировать mutation.

Не enqueue:

- deterministic 4xx;
- `409 idempotency_conflict`;
- `AbortError` пользователя/навигации;
- `session_generation_changed`;
- programming/runtime exception неизвестного происхождения.

## Session ownership

Каждый queued job принадлежит паре:

`userId + logical sessionId`.

Следствия:

- задача A₁ не отправляется с Bearer B;
- после A₁ → B → A₂ задача A₁ не отправляется автоматически и под A₂;
- mismatch не удаляет job и не расходует attempts;
- logout/login во время network flush не позволяет late response изменить queue state старой generation.

## Запрещённый паттерн: toggle

Команда вида `toggle()` не является replay-safe сама по себе.

Пример: реакция в чате.

1. пользователь нажал реакцию;
2. сервер переключил `off → on`;
3. response потерян;
4. клиент повторил тот же toggle;
5. сервер переключил `on → off`.

В результате пользователь получает противоположное состояние при формально «успешном recovery».

Для toggle-команды допустим только один из вариантов:

- заменить API на explicit assignment (`reacted=true/false`, `pinned=true/false`);
- добавить stable request ledger, который возвращает исходный результат replay;
- до этого убрать autoqueue и работать fresh-only.

## Side effects

Replay-safe означает не только «одна строка в таблице».

Повтор не должен создавать второй:

- ActivityEvent;
- Notification;
- DomainOutbox;
- Payment / Expense;
- WorkOrder;
- ChatMessage;
- schedule graph/item set;
- file/storage object, если object ownership является частью mutation.

Если entity commit и side effects находятся в разных транзакциях, команда **не считается квалифицированной**.

## Current qualified core commands

На текущей ветке доказаны или специально переведены в этот контракт:

- manual / scan Receipt create;
- normal ChatMessage create;
- chat Task command;
- chat Invoice command;
- WorkOrder create;
- Stage create;
- Purchase create;
- Selection create;
- QC Issue create;
- material-needs batch generation;
- WorkSchedule create;
- WorkSchedule submit / confirm / reject as guarded explicit state transitions.

`WorkScheduleItem status` пока fresh-only до exact replay qualification.

## Known remaining unsafe / audit-required classes

Минимальный обязательный inventory перед закрытием #316:

- ChatThread create — qualified replacement endpoint exists, runtime/mobile wiring pending;
- chat reaction toggle — unsafe until explicit assignment or request ledger;
- ProjectDocument/file create/upload;
- RoomChangeRequest create;
- WasteOrder create;
- stage comment/photo creates where durable queue is used;
- any other `POST/PATCH/DELETE` producer that writes to `offlineQueue` without a cited replay contract.

Новые queued mutations запрещены без regression test, который моделирует **server commit + lost response + client replay** и доказывает один business result и один required side-effect set.
