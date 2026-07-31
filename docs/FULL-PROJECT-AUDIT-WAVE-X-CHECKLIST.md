# Renova — Wave X execution checklist

**Source of truth:** `FULL-PROJECT-AUDIT-2026-07-31.md`  
**Current `main`:** `c89748944e5bbbe62587f8706ec3d26133d1a649`  
**Current wave:** outbox and background effects

## Wave X.1 — Portal change-order authorization

- [x] Подтвердить defect: pay-only portal token проходит к CO approve/reject.
- [x] Требовать `accept_stage` до любого DB access.
- [x] Отклонять token другого проекта до DB access.
- [x] Использовать project-scoped approve service.
- [x] Использовать `reject_with_effects(project_id, order_id, rejected_by)`.
- [x] Передавать фактического customer как `rejected_by`.
- [x] Удалить legacy CO routes из runtime registry.
- [x] Оставить один approve и один reject route в OpenAPI/runtime.
- [x] Добавить functional/source/runtime tests.
- [x] Включить тест в обязательный backend CI gate.
- [x] Green `e2e` + PostgreSQL Alembic — CI run #1635.
- [x] Green `playwright` — CI run #1635.
- [x] Green `mobile-contracts` — CI run #1635.
- [x] PR #106 merged в `main`: `6547630ba8f4ff06fb2be9607fe5eb7f658d9ee7`.
- [ ] Отдельной волной удалить мёртвые legacy definitions из большого `portal.py`.

## Wave X.2 — OTP / one-time token atomicity

- [x] Проверить issue/verify/consume flow в Redis и fallback storage.
- [x] Подтвердить конкурентную двойную verify: legacy `GET → compare → DELETE` не был single-winner.
- [x] Сделать Redis attempts increment частью одной Lua-операции verify.
- [x] Сделать Redis consume single-winner: compare и delete в одном Lua script.
- [x] Сделать development-memory consume single-winner через per-phone sync lock.
- [x] Production fallback уже запрещён: staging/production требуют Redis и fail closed.
- [x] При достижении лимита неверных попыток атомарно установить lock и удалить код.
- [x] Добавить concurrent tests: 16 параллельных verify → ровно один success.
- [x] Добавить source guard против возврата к read-then-delete.
- [x] Добавить тест в обязательный backend CI gate.
- [x] Green `e2e` + PostgreSQL Alembic — CI run #1643.
- [x] Green `playwright` — CI run #1643.
- [x] Green `mobile-contracts` — CI run #1643.
- [x] PR #107 merged в `main`: `e54581a76e6c2255cb65dce28e6743f3236e0fcb`.
- [ ] Отдельно проверить expiry boundary и Redis clock/TTL semantics.
- [ ] Отдельно проверить rate-limit dimensions: phone/IP/device и enumeration resistance.

## Wave X.3 — Recovery / account lifecycle

- [x] Проверить наличие reset/recovery token flow: в текущем API отдельного password/reset credential flow нет; будущий flow обязан быть single-use и atomic.
- [x] Проверить access-token epoch/revocation: delete и revoke-all выставляют `tokens_invalid_before` в одной транзакции с отзывом refresh-сессий.
- [x] Исправить active sessions revoke-all: zero-row update больше не откатывает pending caller mutations; добавлен `commit=False` contract.
- [x] Исправить account deletion integrity: soft-delete сохраняется даже без refresh-сессий, повторный service transition идемпотентен.
- [x] Устранить zombie-account: `/auth/anonymize` теперь выполняет полноценный soft-delete и отзыв токенов.
- [x] Защитить hard purge: staging/production + feature flag + contractor identity + отдельный ops-secret + exact confirmation phrase.
- [x] Определить текущую policy: soft-delete сохраняет финансовые/audit records; hard purge не получает опасный cascade-delete и может быть заблокирован FK до отдельной retention policy.
- [x] Удалить legacy lifecycle routes из runtime registry по path+method, сохранив `GET /auth/me`.
- [x] Добавить transaction/runtime/source tests и обязательный CI gate.
- [x] Green `e2e` + PostgreSQL Alembic — CI run #1660.
- [x] Green `playwright` — CI run #1660.
- [x] Green `mobile-contracts` — CI run #1660.
- [x] PR #108 merged в `main`: `c89748944e5bbbe62587f8706ec3d26133d1a649`.
- [ ] Спроектировать first-class admin/ops role вместо долгосрочного использования contractor + independent ops secret.
- [ ] Спроектировать retention/anonymization policy для FK-связанных финансовых и проектных записей.
- [ ] При появлении password/recovery flow добавить single-use persisted token, atomic consume и revoke-all после recovery.

## Wave X.4 — Outbox and background effects

- [ ] Unknown event не должен считаться успешно обработанным.
- [ ] Ошибка handler сохраняет retryable state и `last_error`.
- [ ] Есть max attempts / poison event policy.
- [ ] Повторная доставка не дублирует notification/activity/document.
- [ ] Worker claim конкурентно single-winner между процессами.
- [ ] Worker shutdown не теряет claimed event.
- [ ] Метрики backlog/age/failures доступны health/ops.
- [ ] Inline `dispatch_pending` после route commit не маскирует ошибки и не подменяет durable worker.

## Wave X.5 — Product journey revalidation

- [ ] Комната → этап → материалы → оплаты → документы.
- [ ] Этап → приёмка → оплата → акт.
- [ ] CO → бюджет → документ → подпись → уведомления.
- [ ] Work order done/paid не расходится с payment ledger.
- [ ] Approvals/materials load errors видимы и retryable.
- [ ] Manual expense/payment/edit amount имеют confirm + idempotency.
- [ ] Portal read/pay/accept/sign scopes не пересекаются неявно.
- [ ] Offline acceptance показывает queued/synced/conflict state.

## OPS H0 — выполняется на реальной среде

- [ ] Реальный staging HTTPS/API URL.
- [ ] PostgreSQL + Alembic head.
- [ ] `ALLOW_DEMO_SEED=false`, demo auth disabled.
- [ ] YuKassa sandbox/live credentials и webhook smoke.
- [ ] Kontur/eSign provider health и callback smoke.
- [ ] FNS/NPD credentials и truth-mode smoke.
- [ ] Sentry release SHA и тестовый alert.
- [ ] Backup/restore и incident owner.

## Definition of Done каждой волны

- [ ] Defect воспроизводится до fix.
- [ ] Fix не создаёт второй SoT/route/service.
- [ ] Есть runtime или concurrent test, а не только grep.
- [ ] CI green целиком.
- [ ] PR merged в `main`.
- [ ] Merge SHA и residual risks внесены в полный аудит.
