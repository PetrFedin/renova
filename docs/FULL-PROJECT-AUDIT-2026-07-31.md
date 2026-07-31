# Renova — актуальный полный аудит и рабочая матрица

**Дата среза:** 2026-07-31  
**Канонический кодовый baseline:** `main` после PR #110 · `c9c6c48e8356cf5316e6918744087a451f537b5b`  
**Текущая волна:** direct API commit boundaries  
**Назначение:** единый источник истины для продолжения разработки, проверки закрытия аудитов и подготовки staging/pilot.

> Старые аудиты сохраняются как доказательная и продуктовая база, но их статусы необходимо сверять с этим документом и актуальным `main`.

## 1. Источники, объединённые в аудит

- `MARKET-COMPETITIVE-AUDIT-2026-07-15.md` — рынок, конкурентный паритет, продуктовые разрывы.
- `P3-W43-journey-audit-fixes.md` — сквозные пути приёмки, оплаты и гарантии.
- `PRODUCT-AUDIT-DEEP-2026-07-19.md` — глубокий продуктовый и UX-аудит.
- `PRODUCT-AUDIT-SYNTHESIS-2026-07-19.md` — синтез приоритетов Trust / IA / Field.
- `SECURITY-AUDIT-REMEDIATION-PLAN-2026-07-21.md` — security/product remediation.
- `ARCHITECTURE-AUDIT-RU.md` — архитектурные дубли, SoT и инфраструктурный долг.
- `AUDIT-CLOSURE-MATRIX-2026-07-21.md` — историческая closure-матрица wave 1–6.
- `FULL-PROJECT-AUDIT-WAVE-X-CHECKLIST.md` — исполняемый чеклист текущей волны.
- `OTP-ATOMIC-CONSUME-2026-07-31.md` — single-winner OTP consume.
- `ACCOUNT-LIFECYCLE-INTEGRITY-2026-07-31.md` — atomic account deletion и hard-purge guard.
- `OUTBOX-FENCING-AND-FANOUT-2026-07-31.md` — owner-fenced outbox и replay-safe fan-out.
- `YOOKASSA-DELIVERY-INTEGRITY-2026-07-31.md` — durable webhook claim, atomic settlement и Alembic graph guard.

## 2. Правило доверия к статусам

Статус считается `CLOSED` только когда одновременно есть:

1. изменение от актуального `main`;
2. автоматический runtime/concurrent test или проверяемый guard;
3. полностью успешный CI;
4. merge в `main` с зафиксированным SHA.

| Статус | Значение |
|---|---|
| `CLOSED MAIN` | исправление в `main`, есть тесты и green CI |
| `DONE BRANCH` | исправление в ветке, ожидает CI/merge |
| `OPEN CODE` | подтверждённая проблема в актуальном коде |
| `REVERIFY` | находка старого аудита; требуется повторная проверка |
| `OPS` | зависит от staging, секретов, домена или внешнего провайдера |
| `NOT PRESENT` | ожидаемый surface отсутствует; требования фиксируются заранее |
| `NOT TARGET` | сознательно не входит в текущую стратегию продукта |

## 3. Почему старая feature-ветка не переносится целиком

`feature/renova-product-excellence-pass` была на 15 коммитов впереди, но на 202 коммита позади актуального `main`. Она не является источником истины и не должна merge/rebase вслепую.

Из неё используются только:

- продуктовые формулировки и карта разрывов;
- отдельные изменения, повторно подтверждённые на актуальном `main`;
- исторические audit-находки после нового воспроизведения.

## 4. Подтверждённо закрыто в актуальном `main`

| Блок | Статус | Доказательство |
|---|---|---|
| ФНС: честный статус проверки чеков | `CLOSED MAIN` | PR #95 |
| НПД / «Мой налог»: live/scaffold truth | `CLOSED MAIN` | PR #96 |
| OCR metadata truth | `CLOSED MAIN` | PR #97 · `71b4a7c7...` |
| PDF glyph integrity | `CLOSED MAIN` | PR #98 · `7703abc3...` |
| Dashboard read integrity | `CLOSED MAIN` | PR #99 · `374a3a52...` |
| Один canonical dashboard route | `CLOSED MAIN` | PR #100 · `3cbc8bb3...` |
| Project viewer idempotency | `CLOSED MAIN` | PR #101 · `ec4d1fc0...` |
| Access-token revocation fail-closed | `CLOSED MAIN` | PR #102 · `ac5630af...` |
| ACL для unassigned проектов | `CLOSED MAIN` | PR #103 · `63823803...` |
| Atomic team invites | `CLOSED MAIN` | PR #104 · `07cde6f2...` |
| Atomic refresh-token rotation | `CLOSED MAIN` | PR #105 · `63f3d258...` |
| Portal CO scope isolation | `CLOSED MAIN` | PR #106 · `6547630b...` · CI #1635 |
| OTP single-winner consume | `CLOSED MAIN` | PR #107 · `e54581a7...` · CI #1643 |
| Atomic account soft-delete / revoke-all | `CLOSED MAIN` | PR #108 · `c8974894...` · CI #1660 |
| Hard purge fail-closed authorization | `CLOSED MAIN` | PR #108 · `c8974894...` · CI #1660 |
| Owner-fenced outbox claims | `CLOSED MAIN` | PR #109 · `153dedf9...` · CI #1674 |
| Replay-safe acceptance fan-out | `CLOSED MAIN` | PR #109 · `153dedf9...` · CI #1674 |
| Outbox backlog/poison/lease observability | `CLOSED MAIN` | PR #109 · `153dedf9...` · CI #1674 |
| YooKassa durable delivery claim | `CLOSED MAIN` | PR #110 · `c9c6c48e...` · CI #1712 |
| Atomic YooKassa project/subscription settlement | `CLOSED MAIN` | PR #110 · `c9c6c48e...` · CI #1712 |
| YooKassa mismatch/reversal/replay integrity | `CLOSED MAIN` | PR #110 · `c9c6c48e...` · CI #1712 |
| Single Alembic head guard | `CLOSED MAIN` | `w6webhookdelivery01` · CI #1712 |
| Полный mobile contract gate | `CLOSED MAIN` | CI job `mobile-contracts` |

Закрытые темы не возвращаются в backlog без нового воспроизводимого дефекта.

## 5. Закрытая Wave X.1 — portal change-order authorization

### Дефект

Pay-only portal token мог вызвать approve/reject допработ; reject-путь не был достаточно project-scoped и мог записать неверного автора отказа.

### Закрытие

- `accept_stage` и project token проверяются до DB access;
- approve/reject используют project-scoped services;
- reject получает фактического customer как `rejected_by`;
- runtime/OpenAPI содержит ровно по одному маршруту;
- functional/source/runtime tests обязательны в CI;
- PR #106 merged: `6547630ba8f4ff06fb2be9607fe5eb7f658d9ee7`;
- CI #1635 полностью зелёный.

### Остаточный долг

Legacy definitions физически остаются в большом `portal.py`, хотя исключены из runtime registry.

## 6. Закрытая Wave X.2 — OTP atomic consume

### Дефект

Legacy Redis verify выполнял `GET → compare → DELETE`; несколько процессов могли успешно принять один OTP.

### Закрытие

- verify, attempts, lockout и consume выполняются одним Lua script;
- development-memory защищён per-phone lock;
- staging/production fail closed без Redis;
- 16 конкурентных verify дают ровно один success;
- PR #107 merged: `e54581a76e6c2255cb65dce28e6743f3236e0fcb`;
- CI #1643 полностью зелёный.

### Остаточный долг

TTL boundary, Redis clock semantics, rate limits phone/IP/device, enumeration resistance и local lock cleanup.

## 7. Закрытая Wave X.3 — account lifecycle integrity

### Дефекты

- soft-delete мог быть откатан zero-row revoke-all, хотя endpoint возвращал success;
- `/auth/anonymize` оставлял активный zombie-account;
- access epoch и refresh revoke имели разные commit boundaries;
- hard purge при feature flag не имел отдельной ops-авторизации.

### Закрытие

- account anonymization, delete markers, access invalidation и refresh revoke коммитятся одной транзакцией;
- zero active sessions не вызывает rollback;
- hard purge требует staging/production, flag, contractor identity, ops-secret и exact confirmation;
- legacy routes исключены по path+method, `GET /auth/me` сохранён;
- PR #108 merged: `c89748944e5bbbe62587f8706ec3d26133d1a649`;
- CI #1660 полностью зелёный.

### Граница закрытия

Password/reset flow в API отсутствует (`NOT PRESENT`). First-class admin role и FK-safe retention policy остаются открытыми.

## 8. Закрытая Wave X.4 — outbox fencing and replay-safe fan-out

### Дефекты

- stale worker мог завершить новый claim;
- cancellation оставляла committed lease до TTL;
- агрегатный acceptance handler делал несколько commit и дублировал уже выполненные эффекты после crash/retry;
- poison/backlog/lease age не были видны операторам.

### Закрытие

- каждый claim имеет owner token;
- success/failure/abandon/cancel owner-fenced;
- acceptance parent формирует deterministic UUIDv5 leaf-events;
- leaf activity/notification используют `SideEffectDelivery`;
- parent replay не дублирует activity, notification и push ledger;
- release health показывает pending/retryable/poison/leases/oldest age;
- PR #109 merged: `153dedf9c6a615d6b03e6e4421d50e47f1b4fa55`;
- CI #1674 полностью зелёный.

### Граница закрытия

External push остаётся at-least-once. Некоторые inline callers всё ещё маскируют dispatch outcome через silent catch.

## 9. Закрытая Wave X.5 — YooKassa webhook delivery integrity

### Подтверждённые дефекты

1. Durable completion создавался только после business transition, поэтому параллельные одинаковые deliveries могли одновременно войти в обработку.
2. Event без provider object/payment ID мог изменить business state без устойчивого replay key.
3. Pro webhook не требовал точный `kind`, сумму 990 RUB, существующего non-deleted contractor.
4. Project payment привязывал `yookassa_payment_id` отдельным commit до подтверждения.
5. Business state, PaymentEvent, budget/outbox и webhook completion имели разные transaction boundaries.
6. Stale delivery owner не был fenced.
7. Out-of-order refund мог быть признан окончательно обработанным до локального success transition.
8. Secret comparison не был constant-time; production alias не всегда включал IP policy.
9. Новая migration первоначально выявила существующую развилку Alembic graph; до merge граф был выстроен в одну линию.

### Закрытие

- IP policy, shared secret и envelope проверяются до DB claim;
- secret сравнивается `secrets.compare_digest`;
- event key строится из event type и provider object/payment ID;
- missing provider identity получает 400 до mutation;
- `payment_webhook_deliveries` хранит owner token, attempts, retry schedule, outcome, completion и last error;
- concurrent active delivery получает 503 и не запускает business logic второй раз;
- stale owner не может завершить reclaimed event;
- cancellation освобождает только свой claim без attempt;
- project settlement проверяет payment/project, amount, RUB, provider ID и payer metadata при наличии;
- Pro settlement требует `kind=pro_subscription`, 990 RUB, existing non-deleted contractor;
- provider-ID attach, confirm/reversal/subscription, financial events, budget, outbox и completion коммитятся одной транзакцией;
- crash после attach откатывает payment в `pending`, provider ID и completion отсутствуют;
- permanent mismatch не меняет ledger и сохраняется как `business_applied=false`, `ignored:<reason>`;
- временный ordering/availability conflict возвращает 503 и остаётся retryable;
- refund/cancel transitions монотонны и идемпотентны;
- migration `w6webhookdelivery01` продолжает текущий head `w7codoclink001`;
- CI test требует ровно один Alembic head;
- PR #110 merged: `c9c6c48e8356cf5316e6918744087a451f537b5b`;
- CI #1712: 349 backend tests, API smoke, PostgreSQL Alembic, Playwright и весь mobile gate — success.

### Честная граница закрытия

- transport acknowledgement и business application разделены намеренно;
- provider/network delivery остаётся at-least-once, DB transition — single-winner;
- важные settlement желательно дополнительно reconcile через provider API после настройки live credentials;
- ignored/poison outcomes пока не выведены в отдельную payment-ops панель;
- cleanup/retention для delivery rows ещё не определены;
- legacy compatibility helpers остаются в service, но canonical endpoint их не использует.

## 10. Активная очередь проверки и исправлений

### P0 — Security / transaction integrity

| Приоритет | Зона | Что доказать |
|---|---|---|
| P0.1 | Direct API commits | state и обязательные side-effects не расходятся после commit/exception |
| P0.2 | OTP abuse surface | TTL boundary, phone/IP/device rate limits, enumeration resistance |
| P0.3 | Account retention | FK-safe anonymization без потери обязательной финансовой истории |
| P0.4 | Outbox telemetry | убрать silent inline catches и подключить poison/backlog alerting |
| P0.5 | Payment operations | ignored/poison webhook outcomes, reconciliation и retention |
| P0.6 | Future recovery flow | single-use atomic token и revoke-all до production endpoint |

### P1 — Product journey / dead ends

| Зона | Статус | Следующая проверка |
|---|---|---|
| Комната ↔ этап ↔ материалы ↔ оплаты ↔ документы | `REVERIFY` | пройти customer/contractor journey на текущем mobile |
| Approvals network/403 states | `REVERIFY` | отсутствие silent empty и понятный retry |
| Manual money actions | `REVERIFY` | confirm, proof, idempotency и возврат к budget SoT |
| Work order paid transition | `REVERIFY` | статус и финансовый факт не расходятся |
| Portal sign/pay UX | `REVERIFY` | pre-confirm, scope, replay и honest live/demo mode |
| Offline field acceptance | `REVERIFY` | очередь, merge, 409 policy и видимый sync state |

### P2 — Архитектура и поддерживаемость

| Зона | Статус | Цель |
|---|---|---|
| Декомпозиция `portal.py` | `OPEN CODE` | переносить bounded routes без runtime-дублей |
| Legacy route/source debt | `OPEN CODE` | удалить мёртвые definitions после безопасной миграции |
| First-class admin/ops identity | `OPEN CODE` | заменить contractor role на явную ops-модель |
| Service transaction boundaries | `REVERIFY` | route не собирает частичную транзакцию вручную |
| Alembic graph integrity | `CLOSED MAIN` | один head контролируется CI; сохранять линейность |

## 11. OPS-блокеры, которые код не закрывает самостоятельно

| Блокер | Статус | DoD |
|---|---|---|
| Реальный staging URL и HTTPS | `OPS` | mobile использует доступный API, не placeholder |
| PostgreSQL staging + migrations | `OPS` | upgrade head, backup/restore и runbook |
| YooKassa credentials | `OPS` | sandbox/live checkout, webhook и provider reconciliation |
| Контур/подпись credentials | `OPS` | provider health + callback smoke |
| ФНС/Мой налог credentials | `OPS` | live integration отдельно от scaffold/demo |
| Sentry/alerts | `OPS` | DSN, release SHA, alert routing и тестовое событие |
| Account purge runbook | `OPS` | restricted operator, backup/dry-run и audit trail |

## 12. Конкурентная стратегия

### Сохранять как moat

- единый путь смета → lock → график → приёмка → payment gate → документы;
- dual-role customer/contractor;
- честные money/integration statuses без demo-as-live;
- ФНС/НПД для российского рынка;
- Documents Hub и доказательная история;
- field/offline только с наблюдаемой очередью и conflict policy.

### Не расширять до закрытия Trust и transaction integrity

- Procore-подобные BIM/RFI enterprise-модули;
- marketplace внутри project chat;
- AI-chat на каждом экране;
- новые витринные surfaces без доказанного end-to-end пути.

## 13. Порядок дальнейшей работы

1. Найти оставшиеся direct `commit()` перед обязательными side-effects и закрыть подтверждённые разрывы через unit-of-work/outbox.
2. Убрать silent inline outbox catches и связать poison/backlog с alerting.
3. Закрыть OTP abuse surface.
4. Повторно пройти ключевые product journeys на текущем `main`.
5. Спроектировать FK-safe retention и first-class admin/ops identity.
6. Вывести payment webhook ignored/poison outcomes и добавить provider reconciliation.
7. Выполнить staging OPS checklist с реальными credentials.
8. После каждой волны обновлять эту матрицу, а не создавать независимый противоречащий backlog.

## 14. Definition of Done проекта перед pilot

Pilot-ready означает доказанный путь:

`создание объекта → смета → фиксация → график → выполнение → приёмка → подтверждённая оплата → документ/подпись → история/уведомления`

Для каждого перехода обязательны:

- ACL и explicit scope;
- idempotency/replay policy;
- единая транзакция state + durable side-effects;
- fail-closed поведение;
- user-visible error/retry;
- runtime/concurrent test;
- green CI на PostgreSQL/API/mobile.
