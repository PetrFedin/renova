# Renova — актуальный полный аудит и рабочая матрица

**Дата среза:** 2026-07-31  
**Каноническая база:** `main` @ `63f3d2585f0781ca22174cb8a3473ce4c9d56f5f`  
**Рабочая ветка текущей волны:** `agent/audit-wave-x-portal-scope`  
**Назначение:** единый источник истины для продолжения разработки, проверки закрытия аудитов и подготовки staging/pilot.

> Этот документ заменяет использование старых аудитов как текущего backlog. Старые файлы сохраняются как доказательная и продуктовая база, но их статусы необходимо сверять здесь с актуальным `main`.

## 1. Источники, объединённые в аудит

- `MARKET-COMPETITIVE-AUDIT-2026-07-15.md` — рынок, конкурентный паритет, продуктовые разрывы.
- `P3-W43-journey-audit-fixes.md` — сквозные пути приёмки, оплаты, гарантии.
- `PRODUCT-AUDIT-DEEP-2026-07-19.md` — глубокий продуктовый и UX-аудит.
- `PRODUCT-AUDIT-SYNTHESIS-2026-07-19.md` — синтез приоритетов Trust / IA / Field.
- `SECURITY-AUDIT-REMEDIATION-PLAN-2026-07-21.md` — security/product remediation.
- `ARCHITECTURE-AUDIT-RU.md` — архитектурные дубли, SoT и инфраструктурный долг.
- `AUDIT-CLOSURE-MATRIX-2026-07-21.md` — историческая closure-матрица wave 1–6.
- `FULL-PROJECT-AUDIT-WAVE-X-CHECKLIST.md` — рабочий чеклист текущей волны.

## 2. Правило доверия к статусам

Статус считается `CLOSED` только когда одновременно есть:

1. изменение в актуальной ветке от `main`;
2. автоматический тест или проверяемый source/runtime guard;
3. успешный CI;
4. merge в `main` с зафиксированным SHA.

Обозначения:

| Статус | Значение |
|---|---|
| `CLOSED MAIN` | исправление уже в `main`, есть тесты/CI |
| `DONE BRANCH` | исправление реализовано в текущей ветке, ожидает PR/CI/merge |
| `OPEN CODE` | подтверждённая проблема в актуальном коде |
| `REVERIFY` | находка старого аудита; требуется повторная проверка на текущем `main` |
| `OPS` | зависит от staging, домена, секретов или внешнего провайдера |
| `NOT TARGET` | сознательно не входит в текущую стратегию продукта |

## 3. Почему старая feature-ветка не переносится целиком

`feature/renova-product-excellence-pass` расходится с текущим `main`: она была **на 15 коммитов впереди, но на 202 коммита позади**. Её нельзя merge/rebase вслепую как источник истины.

Из неё используются только:

- полезные формулировки и продуктовая карта;
- отдельные изменения, которые повторно подтверждаются на актуальном `main`;
- `FULL-PROJECT-AUDIT-2026-07-31.md` как исторический снимок, переписанный в этот актуальный документ.

Кодовые изменения из старой ветки переносятся только отдельными PR после проверки конфликтов, расчётов, ACL и тестов.

## 4. Подтверждённо закрыто в актуальном `main`

| Блок | Статус | Доказательство |
|---|---|---|
| ФНС: честный статус проверки чеков | `CLOSED MAIN` | PR #95 |
| НПД / «Мой налог»: разделение live/scaffold | `CLOSED MAIN` | PR #96 |
| OCR metadata truth | `CLOSED MAIN` | PR #97 · `71b4a7c7...` |
| PDF: кириллица и glyph integrity | `CLOSED MAIN` | PR #98 · `7703abc3...` |
| Dashboard read integrity / degraded state | `CLOSED MAIN` | PR #99 · `374a3a52...` |
| Один канонический dashboard route | `CLOSED MAIN` | PR #100 · `3cbc8bb3...` |
| Project viewer idempotency | `CLOSED MAIN` | PR #101 · `ec4d1fc0...` |
| Access-token revocation fail-closed | `CLOSED MAIN` | PR #102 · `ac5630af...` |
| ACL для проектов без назначенного подрядчика | `CLOSED MAIN` | PR #103 · `63823803...` |
| Atomic team invites | `CLOSED MAIN` | PR #104 · `07cde6f2...` |
| Atomic refresh-token rotation | `CLOSED MAIN` | PR #105 · `63f3d258...` |
| `npm run mobile:test` в CI | `CLOSED MAIN` | job `mobile-contracts` |

Эти темы не должны возвращаться в backlog без нового воспроизводимого дефекта.

## 5. Текущая волна: portal change-order scope

### Подтверждённая проблема

Portal-token с правом только `pay` мог вызвать approve/reject допработ, потому что legacy endpoint проверял пользователя-заказчика, но не требовал scope `accept_stage`.

У reject-пути был дополнительный риск: legacy compatibility service получал только `order_id`; принадлежность проекту проверялась после вызова, а автором отказа мог становиться создатель допработы вместо фактического заказчика.

### Реализовано в ветке

| Изменение | Статус |
|---|---|
| Канонический модуль `portal_change_order_decisions.py` | `DONE BRANCH` |
| Scope `accept_stage` проверяется до обращения к БД | `DONE BRANCH` |
| Wrong-project token отклоняется до обращения к БД | `DONE BRANCH` |
| Reject использует `reject_with_effects(project_id, order_id, rejected_by)` | `DONE BRANCH` |
| В runtime/OpenAPI остаётся ровно один approve и один reject route | `DONE BRANCH` |
| Pay-only token → 403 | `DONE BRANCH` |
| Тест реального `rejected_by` | `DONE BRANCH` |

### Критерий закрытия

- новый тест включён в CI;
- e2e, Playwright и mobile-contracts зелёные;
- PR смержен в `main`;
- merge SHA записан в этот документ/следующую closure-матрицу.

## 6. Активная очередь проверки и исправлений

Ниже только приоритеты, которые логично проверять после portal scope. Это не утверждение, что каждый дефект уже подтверждён.

### P0 — Security / transaction integrity

| Приоритет | Зона | Что доказать |
|---|---|---|
| P0.1 | OTP / одноразовые коды | один код нельзя принять дважды при конкурентных запросах; attempts и consume атомарны |
| P0.2 | Recovery/reset tokens | одноразовость, expiry, revocation и отсутствие replay |
| P0.3 | Account deletion | подтверждение, ACL, очистка/анонимизация и идемпотентность |
| P0.4 | Outbox/background effects | unknown event не помечается успешно обработанным; retry/poison policy наблюдаемы |
| P0.5 | Payment webhooks | mismatch/replay/failure не превращаются в ложный success |
| P0.6 | Direct API commits | состояние и side-effects не расходятся при исключении после commit |

### P1 — Product journey / dead ends

| Зона | Статус | Следующая проверка |
|---|---|---|
| Комната ↔ этап ↔ материалы ↔ оплаты ↔ документы | `REVERIFY` | пройти customer/contractor journey на текущем mobile |
| Approvals network/403 states | `REVERIFY` | отсутствие silent empty и понятный retry |
| Manual money actions | `REVERIFY` | confirm, proof, idempotency, возврат к канону бюджета |
| Work order paid transition | `REVERIFY` | статус и финансовый факт не расходятся |
| Portal sign/pay UX | `REVERIFY` | pre-confirm, scope, replay, honest live/demo mode |
| Offline field acceptance | `REVERIFY` | очередь, merge, 409 policy и видимый статус синхронизации |

### P2 — Архитектура и поддерживаемость

| Зона | Статус | Цель |
|---|---|---|
| Декомпозиция большого `portal.py` | `OPEN CODE` | переносить bounded routes по одному без runtime-дублей |
| Legacy route/source debt | `OPEN CODE` | после миграции удалить мёртвые определения, не только исключать из router registry |
| Единство service transaction boundaries | `REVERIFY` | route не должен сам собирать частичную транзакцию |
| Source guards vs runtime tests | `REVERIFY` | критические деньги/ACL подтверждать функционально и конкурентно |

## 7. OPS-блокеры, которые код не может закрыть самостоятельно

| Блокер | Статус | DoD |
|---|---|---|
| Реальный staging URL и HTTPS | `OPS` | приложение обращается к доступному API, не placeholder |
| PostgreSQL staging + migrations | `OPS` | Alembic head, smoke и backup/restore procedure |
| YuKassa live/test credentials | `OPS` | реальный sandbox/live checkout + webhook delivery |
| Контур/подпись credentials | `OPS` | provider health + callback/webhook smoke |
| ФНС/Мой налог credentials | `OPS` | live integration отдельно от scaffold/demo |
| Sentry/alerts | `OPS` | DSN, release SHA, alert routing и проверка события |

## 8. Конкурентная стратегия: что сохранять и что не строить

### Сохранять как moat

- единый путь смета → lock → график → приёмка → gate оплаты → документы;
- dual-role customer/contractor;
- честные статусы money/integration, без подмены demo на live;
- ФНС/НПД для российского рынка;
- Documents Hub и доказательная история действий;
- field/offline только там, где есть наблюдаемая очередь и разрешение конфликтов.

### Не тащить в текущий scope

- Procore-подобные BIM/RFI enterprise-модули;
- marketplace внутри project chat;
- AI-chat на каждом экране;
- новые витринные экраны до закрытия Trust, transaction integrity и dead ends.

## 9. Порядок дальнейшей работы

1. Закрыть текущую portal-scope волну через PR/CI/merge.
2. Провести атомарный аудит OTP и recovery tokens.
3. Проверить outbox/worker fail semantics и poison events.
4. Повторно пройти product journeys из старых аудитов на текущем `main`.
5. Отдельно выполнить staging OPS checklist с реальными credentials.
6. После каждой волны обновлять эту матрицу, а не создавать независимый противоречащий документ.

## 10. Definition of Done проекта перед pilot

Pilot-ready означает не наличие экранов, а доказанный путь:

`создание объекта → смета → фиксация → график → выполнение → приёмка → подтверждённая оплата → документ/подпись → история/уведомления`

Для каждого перехода должны быть:

- ACL и explicit scope;
- идемпотентность/replay policy;
- единая транзакция состояния и durable side-effects;
- fail-closed поведение;
- user-visible error/retry;
- автоматический тест;
- green CI на PostgreSQL/API/mobile.
