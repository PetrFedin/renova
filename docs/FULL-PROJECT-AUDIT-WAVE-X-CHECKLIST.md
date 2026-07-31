# Renova — Wave X execution checklist

**Source of truth:** `FULL-PROJECT-AUDIT-2026-07-31.md`  
**Current `main`:** `e54581a76e6c2255cb65dce28e6743f3236e0fcb`  
**Current wave:** recovery/account lifecycle audit

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

- [ ] Проверить reset/recovery token replay.
- [ ] Проверить token epoch/revocation после смены пароля.
- [ ] Проверить active sessions revoke-all.
- [ ] Проверить account deletion confirmation и idempotency.
- [ ] Определить anonymize/delete policy для финансовых и audit records.
- [ ] Добавить tests/CI/docs.

## Wave X.4 — Outbox and background effects

- [ ] Unknown event не должен считаться успешно обработанным.
- [ ] Ошибка handler сохраняет retryable state и last_error.
- [ ] Есть max attempts / poison event policy.
- [ ] Повторная доставка не дублирует notification/activity/document.
- [ ] Worker shutdown не теряет claimed event.
- [ ] Метрики backlog/age/failures доступны health/ops.

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
