# Renova — актуальный полный аудит и рабочая матрица

**Дата среза:** 2026-07-31  
**Канонический кодовый baseline:** `main` после PR #107 · `e54581a76e6c2255cb65dce28e6743f3236e0fcb`  
**Текущая волна:** recovery/account lifecycle  
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
- `FULL-PROJECT-AUDIT-WAVE-X-CHECKLIST.md` — исполняемый чеклист текущей волны.
- `OTP-ATOMIC-CONSUME-2026-07-31.md` — доказательство single-winner OTP consume.

## 2. Правило доверия к статусам

Статус считается `CLOSED` только когда одновременно есть:

1. изменение в актуальной ветке от `main`;
2. автоматический тест или проверяемый source/runtime guard;
3. успешный CI;
4. merge в `main` с зафиксированным SHA.

| Статус | Значение |
|---|---|
| `CLOSED MAIN` | исправление уже в `main`, есть тесты/CI |
| `DONE BRANCH` | исправление реализовано в ветке, ожидает PR/CI/merge |
| `OPEN CODE` | подтверждённая проблема в актуальном коде |
| `REVERIFY` | находка старого аудита; требуется повторная проверка на текущем `main` |
| `OPS` | зависит от staging, домена, секретов или внешнего провайдера |
| `NOT TARGET` | сознательно не входит в текущую стратегию продукта |

## 3. Почему старая feature-ветка не переносится целиком

`feature/renova-product-excellence-pass` расходилась с актуальным `main`: была **на 15 коммитов впереди, но на 202 коммита позади**. Её нельзя merge/rebase вслепую как источник истины.

Из неё используются только:

- полезные формулировки и продуктовая карта;
- отдельные изменения, повторно подтверждённые на актуальном `main`;
- исторический audit snapshot, переписанный в эту актуальную матрицу.

Код из старой ветки переносится только отдельными PR после проверки конфликтов, расчётов, ACL, transaction boundaries и тестов.

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
| Portal change-order scope isolation | `CLOSED MAIN` | PR #106 · `6547630b...` · CI #1635 |
| OTP atomic single-winner consume | `CLOSED MAIN` | PR #107 · `e54581a7...` · CI #1643 |
| Полный mobile contract gate | `CLOSED MAIN` | CI job `mobile-contracts` |

Эти темы не должны возвращаться в backlog без нового воспроизводимого дефекта.

## 5. Закрытая Wave X.1 — portal change-order authorization

### Подтверждённый дефект

Portal-token с правом только `pay` мог вызвать approve/reject допработ, потому что legacy endpoint проверял пользователя-заказчика, но не требовал scope `accept_stage`.

У reject-пути был дополнительный риск: compatibility service получал только `order_id`; принадлежность проекту проверялась после вызова, а автором отказа мог становиться создатель допработы вместо фактического заказчика.

### Закрытие

- `accept_stage` проверяется до первого DB access;
- wrong-project token отклоняется до DB access;
- approve/reject используют project-scoped services;
- reject записывает фактического customer как `rejected_by`;
- runtime/OpenAPI содержит ровно один approve и один reject route;
- pay-only token получает 403;
- functional/source/runtime tests обязательны в CI;
- PR #106 merged: `6547630ba8f4ff06fb2be9607fe5eb7f658d9ee7`;
- CI run #1635: e2e/PostgreSQL, Playwright и mobile-contracts — success.

### Остаточный долг

Legacy определения физически остаются в большом `portal.py`, хотя исключены из runtime registry. Их необходимо удалить в отдельной безопасной декомпозиционной волне.

## 6. Закрытая Wave X.2 — OTP atomic consume

### Подтверждённый дефект

Legacy verify выполнял Redis `GET → compare → DELETE` отдельными командами. Два worker/process могли прочитать один digest до удаления и оба успешно принять один OTP. Attempts, lockout и invalidation также не образовывали единой операции.

### Закрытие

- Redis verify, attempts, lockout и consume выполняются одним Lua script;
- successful OTP удаляется в той же атомарной операции;
- при пяти неверных попытках lock устанавливается вместе с удалением текущего кода;
- staging/production не переходят на process-memory при недоступном Redis;
- development-memory использует per-phone sync lock;
- 16 конкурентных verify дают ровно один success;
- source guard запрещает возврат к read-then-delete;
- PR #107 merged: `e54581a76e6c2255cb65dce28e6743f3236e0fcb`;
- CI run #1643: e2e/PostgreSQL, Playwright и mobile-contracts — success.

### Остаточные задачи OTP surface

- TTL boundary и Redis clock/expiry semantics;
- rate-limit dimensions по phone/IP/device;
- enumeration resistance send/verify ответов;
- ограничение роста local per-phone lock registry в development;
- recovery/reset tokens рассматриваются отдельно.

## 7. Активная очередь проверки и исправлений

### P0 — Security / transaction integrity

| Приоритет | Зона | Что доказать |
|---|---|---|
| P0.1 | Recovery/reset tokens | одноразовость, expiry, revocation и отсутствие replay |
| P0.2 | Account deletion | подтверждение, ACL, очистка/анонимизация и идемпотентность |
| P0.3 | Outbox/background effects | unknown event не помечается успешно обработанным; retry/poison policy наблюдаемы |
| P0.4 | Payment webhooks | mismatch/replay/failure не превращаются в ложный success |
| P0.5 | Direct API commits | состояние и side-effects не расходятся при исключении после commit |
| P0.6 | OTP abuse surface | TTL boundary, phone/IP/device rate limits, enumeration resistance |

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

## 8. OPS-блокеры, которые код не может закрыть самостоятельно

| Блокер | Статус | DoD |
|---|---|---|
| Реальный staging URL и HTTPS | `OPS` | приложение обращается к доступному API, не placeholder |
| PostgreSQL staging + migrations | `OPS` | Alembic head, smoke и backup/restore procedure |
| YuKassa live/test credentials | `OPS` | реальный sandbox/live checkout + webhook delivery |
| Контур/подпись credentials | `OPS` | provider health + callback/webhook smoke |
| ФНС/Мой налог credentials | `OPS` | live integration отдельно от scaffold/demo |
| Sentry/alerts | `OPS` | DSN, release SHA, alert routing и проверка события |

## 9. Конкурентная стратегия

### Сохранять как moat

- единый путь смета → lock → график → приёмка → gate оплаты → документы;
- dual-role customer/contractor;
- честные статусы money/integration, без подмены demo на live;
- ФНС/НПД для российского рынка;
- Documents Hub и доказательная история действий;
- field/offline только с наблюдаемой очередью и разрешением конфликтов.

### Не тащить в текущий scope

- Procore-подобные BIM/RFI enterprise-модули;
- marketplace внутри project chat;
- AI-chat на каждом экране;
- новые витринные экраны до закрытия Trust, transaction integrity и dead ends.

## 10. Порядок дальнейшей работы

1. Проверить recovery/reset token replay и account lifecycle.
2. Проверить outbox/worker fail semantics и poison events.
3. Проверить payment webhooks и оставшиеся direct commits.
4. Повторно пройти product journeys из старых аудитов на текущем `main`.
5. Отдельно выполнить staging OPS checklist с реальными credentials.
6. После каждой волны обновлять эту матрицу, а не создавать независимый противоречащий документ.

## 11. Definition of Done проекта перед pilot

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
