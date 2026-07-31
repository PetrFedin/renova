# Renova — Wave X execution checklist

**Source of truth:** `FULL-PROJECT-AUDIT-2026-07-31.md`  
**Current `main`:** `153dedf9c6a615d6b03e6e4421d50e47f1b4fa55`  
**Current wave:** payment webhooks and direct commit boundaries

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

- [x] Unknown event не считается успешно обработанным: сохраняются `attempts`, `last_error`, retry schedule.
- [x] Ошибка handler сохраняет retryable state; после `MAX_ATTEMPTS=8` событие становится poison и не hot-loopится.
- [x] Claim получает уникальный owner token; stale worker не может завершить или испортить новый claim.
- [x] Worker cancellation немедленно освобождает принадлежащий ему lease без расходования attempt.
- [x] `acceptance.side_effects` разворачивается в детерминированные UUIDv5 leaf-events.
- [x] Повтор parent-event не дублирует activity, notification, push delivery ledger или document notification fan-out.
- [x] Existing financial leaf-events сохраняют idempotency через `SideEffectDelivery`.
- [x] Метрики pending/retryable/poisoned/active leases/stale leases/oldest age доступны в `/admin/release-health`.
- [x] Добавлены concurrent/replay/runtime tests и обязательный CI gate.
- [x] Green `e2e` + PostgreSQL Alembic — CI run #1674.
- [x] Green `playwright` — CI run #1674.
- [x] Green `mobile-contracts` — CI run #1674.
- [x] PR #109 merged в `main`: `153dedf9c6a615d6b03e6e4421d50e47f1b4fa55`.
- [x] Inline dispatch failure не теряет событие: durable outbox row остаётся для worker retry.
- [ ] Удалить silent `except Exception: pass` из inline dispatch callers и писать outcome в telemetry/audit.
- [ ] Для внешнего push использовать `outbox_id` как provider/client dedup key, где это поддерживается; доставка остаётся at-least-once.

## Wave X.5 — Payment webhooks and direct commit boundaries

- [ ] Проверить подпись/секрет webhook до DB lookup и mutation.
- [ ] Проверить provider event id / replay single-winner при конкурентной доставке.
- [ ] Проверить amount/currency/project/payment mismatch до подтверждения платежа.
- [ ] Unknown provider status не должен возвращать ложный success и менять ledger.
- [ ] Failure после provider acceptance не должен оставлять payment status без event/audit/outbox.
- [ ] Refund/cancel/chargeback transition должен быть монотонным и идемпотентным.
- [ ] Проверить все route/service `commit()` перед side-effects и перенести подтверждённые дефекты на outbox/unit-of-work.
- [ ] Добавить concurrent/runtime tests и обязательный CI gate.

## Wave X.6 — Product journey revalidation

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
