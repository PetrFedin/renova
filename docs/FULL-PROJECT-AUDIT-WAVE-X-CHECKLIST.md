# Renova — Wave X execution checklist

**Source of truth:** `FULL-PROJECT-AUDIT-2026-07-31.md`  
**Current `main`:** `c9c6c48e8356cf5316e6918744087a451f537b5b`  
**Current wave:** direct API commit boundaries

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

- [x] Подтвердить конкурентную двойную verify: legacy `GET → compare → DELETE` не был single-winner.
- [x] Сделать Redis verify/attempts/lockout/consume одной Lua-операцией.
- [x] Сделать development-memory consume single-winner через per-phone sync lock.
- [x] Production fallback запретить: staging/production требуют Redis и fail closed.
- [x] Добавить concurrent tests: 16 параллельных verify → ровно один success.
- [x] Green full CI — run #1643.
- [x] PR #107 merged: `e54581a76e6c2255cb65dce28e6743f3236e0fcb`.
- [ ] Проверить expiry boundary и Redis clock/TTL semantics.
- [ ] Проверить rate-limit dimensions: phone/IP/device и enumeration resistance.

## Wave X.3 — Recovery / account lifecycle

- [x] Установить, что password/reset credential flow в текущем API отсутствует.
- [x] Сделать soft-delete, access-token invalidation и refresh revoke одной транзакцией.
- [x] Zero-row revoke-all больше не откатывает pending account mutations.
- [x] `/auth/anonymize` больше не оставляет активный zombie-account.
- [x] Hard purge защищён environment + flag + contractor identity + ops-secret + confirmation phrase.
- [x] Legacy lifecycle routes исключены из runtime registry по path+method, `GET /auth/me` сохранён.
- [x] Green full CI — run #1660.
- [x] PR #108 merged: `c89748944e5bbbe62587f8706ec3d26133d1a649`.
- [ ] Спроектировать first-class admin/ops role.
- [ ] Спроектировать FK-safe retention/anonymization policy.
- [ ] При появлении recovery flow добавить persisted single-use token и revoke-all.

## Wave X.4 — Outbox and background effects

- [x] Unknown event сохраняет `attempts`, `last_error` и retry schedule.
- [x] После `MAX_ATTEMPTS=8` событие становится poison и не hot-loopится.
- [x] Claim получает уникальный owner token; stale worker не завершает новый claim.
- [x] Cancellation немедленно освобождает lease без расходования attempt.
- [x] `acceptance.side_effects` разворачивается в детерминированные UUIDv5 leaf-events.
- [x] Parent replay не дублирует activity, notification, push delivery ledger или document fan-out.
- [x] Метрики backlog/poison/lease age доступны в `/admin/release-health`.
- [x] Green full CI — run #1674.
- [x] PR #109 merged: `153dedf9c6a615d6b03e6e4421d50e47f1b4fa55`.
- [ ] Удалить silent `except Exception: pass` из inline dispatch callers и писать telemetry.
- [ ] Использовать `outbox_id` как external push dedup key, где это поддерживается.

## Wave X.5 — YooKassa webhook delivery integrity

- [x] IP/secret/envelope проверяются до DB claim и business mutation.
- [x] Secret сравнивается constant-time через `secrets.compare_digest`.
- [x] Provider event identity включает event type и provider object/payment ID.
- [x] Missing provider ID отклоняется до создания delivery row.
- [x] Durable claim обеспечивает inter-process single-winner и owner fencing.
- [x] Busy concurrent delivery возвращает retryable 503 и не запускает business logic второй раз.
- [x] Stale owner не может завершить reclaimed delivery.
- [x] Project payment проверяет payment/project, amount, RUB, provider ID и payer metadata при наличии.
- [x] Pro subscription требует `kind=pro_subscription`, 990 RUB, существующего non-deleted contractor.
- [x] Attach provider ID, confirm/reversal/subscription state, events, budget, outbox и completion коммитятся одной транзакцией.
- [x] Crash после provider-ID attach полностью откатывает payment и не создаёт completion marker.
- [x] Unsupported/permanent mismatch не меняет ledger и фиксируется как `business_applied=false`, `ignored:<reason>`.
- [x] Out-of-order refund остаётся retryable; terminal conflict монотонен и не retry-loopится.
- [x] Cancellation освобождает claim без расходования attempt.
- [x] Добавлена линейная migration `w6webhookdelivery01` после `w7codoclink001`.
- [x] CI guard требует ровно один Alembic head.
- [x] 349 backend tests + API smoke + PostgreSQL Alembic — CI run #1712.
- [x] Playwright — CI run #1712.
- [x] Полный mobile contract gate — CI run #1712.
- [x] PR #110 merged в `main`: `c9c6c48e8356cf5316e6918744087a451f537b5b`.
- [ ] Вывести ignored/poison webhook outcomes в payment-ops dashboard и alerting.
- [ ] Добавить provider API reconciliation для критичных settlement, когда настроены live credentials.
- [ ] Определить retention/cleanup policy для `payment_webhook_deliveries`.

## Wave X.6 — Direct API commit boundaries

- [ ] Найти routes/services, где `commit()` выполняется до activity/notification/document/push side-effects.
- [ ] Отделить безопасные post-commit best-effort эффекты от обязательных durable effects.
- [ ] Перенести обязательные эффекты в unit-of-work или deterministic outbox leaf-events.
- [ ] Проверить rollback при ошибке после частичной подготовки state.
- [ ] Проверить replay/idempotency каждого исправленного transition.
- [ ] Убрать ложные success responses после rollback или частичного commit.
- [ ] Добавить runtime/concurrent/source guards и обязательный CI gate.

## Wave X.7 — Product journey revalidation

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
- [ ] YooKassa sandbox/live credentials и webhook smoke.
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
