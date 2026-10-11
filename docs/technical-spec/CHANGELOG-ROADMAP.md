# Renova — журнал изменений и план завершения продукта

**Срез:** 2026-09-08, `main` `95dd4a8e117289df11e1300891490768c22f585f`.
**Статус:** `BLOCKED_FOR_BROAD_PRODUCTION`.
**Полный аудит:** `PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md`.
**Историческая редакция:** `history/CHANGELOG-ROADMAP-before-2026-09-08.md`; её очередь работ не является текущей.

Канон: **наблюдение → решение → код/данные → тест → evidence → следующий шаг**.
Каждая строка исправления требует одного bounded PR и обновления соответствующего ТЗ; оформление UI не отделяется от прав, ошибок и восстановления.

## 1. Уже интегрировано, но не равно полной готовности

| Изменение | Репозиторное доказательство | Что этим не закрыто |
|---|---|---|
| #288 локальный runtime/агентский контекст | Merge7bd1dceb273a7e1f26ddf2333e9199d8d498ae54 | Внешний staging/production. |
| #290 logical restore | Run33344103969, merge748ed5f22db0bfe18001f276ec521d0198d4dc57 | Managed backup/PITR, измеренный RPO/RTO. |
| #292 обычные сообщения чата | Merge9d3f96bad6138aef7f7db32407162fe07897572d | Chat task/invoice/reaction, native export, external storage. |
| #295 гарантийное создание | Merge9fed24c1b59d767daef4d6395fd01cb303c838e3 | Весь post-closeout/provider сценарий. |
| #297 manual payment evidence | Merge389f35d819dbf0b81d2e821da851fa9a647705d2 | Любой источник платежей вообще; S3 ambiguity. |
| #309/#310 supply readiness и явный start | w20materialsupply01 | Multi-contractor и granular partial delivery/payment acceptance. |
| #311 price provenance | Merge85f8d279d393b42bae5d76fea333f9d13c8ae0b5, w21materialprice01 | Цена поставщика не становится вечной офертой. |
| #312 participant foundation | Merge38657631348ea7bbe9a22cd5d631cb4ddba0250e, w22projectparticipants01 | Полный #300. |
| #313 management + atomic lead conversion | Headae8a0750bb6cc788c9e93a1f85a7355f3b180380; CI34262996030; PostgreSQL34262996112; merge65ddb7e59e6bcb23473b1017686cd3adbd882187 | Scoped domain/mobile adoption, legacy writers/quota/source transitions. |
| #314 quoted-lead wizard recovery | Head6e88a1d15883964b1c3f4f0a0f203fb6ef2f0817; CI34264654118; merge95dd4a8e117289df11e1300891490768c22f585f | Общий #315, cold-start discovery, dedicated device E2E. |

## 2. Текущие продуктовые приоритеты

| Очередь | Задача / владелец функции | Закрываемый результат | Обязательное доказательство |
|---|---|---|---|
| P0 | #316 backend+mobile | Повтор первого POST не создаёт второй счёт/работу/набор связей | Response-loss и PostgreSQL same-key race, один atomic commit. |
| P1 launch-blocking, параллельно P0 | #315 mobile/session security | Старый аккаунт не публикует state/token/cache и не исполняет очередь как новый | A→B→A, shared-project actors, delayed refresh/load/flush, token+storage fences. |
| P1 после/вместе #316 | #317 mobile transport | Нормализованная сетевая ошибка достигает правильной очереди; кэш не выдаётся за свежий | Реальные req→producer→storage→flush; 4xx/timeout/cancel; per-resource freshness. |
| P1 | #318 finance+mobile/backend | Части плана сходятся с целым; неизвестный факт не нулевое отклонение | Консервативное округление, 28–31 день, category ledger, timezone. |
| P1 | #319 backend/data lifecycle | Удаление непустого проекта согласовано с participant/evidence/retention графом | PostgreSQL full graph, hold/refusal, rollback, restore и S3 recovery. |
| P1 | #320 mobile files | Кнопка выдаёт native PDF/share результат | iOS/Android+web, auth/session, cancel/cleanup и содержимое файла. |
| P1 | #305 mobile/product | Успешная операция не становится «не сохранено» из-за refresh; единый UI | Commit-success + sync-failure, role/error/empty/stale/accessibility матрица. |
| P1 после session boundary | #300 backend+mobile/product | Заказчик и независимые подрядчики проходят один реальный ремонт с изоляцией | G03, scoped reads/writes/payees/documents/chat, no sibling IDOR. |
| P1 отдельный поток | #238 integrations/operator | Неопределённый ответ провайдера восстанавливается без дублирования/выдуманного успеха | Authoritative provider read, retries/DLQ/replay, внешний evidence. |

## 3. Внешние работы выполняются параллельно, а не после всех экранов

#247: реальная защита main/required checks и отрицательная проверка обхода; владелец repository administration.
#233: постоянный staging с TLS/DNS/managed dependencies и exact-artifact promotion; владелец DevOps/SRE.
#235/#283: ingestion→alert→delivery→ACK→recovery; владелец observability/on-call. Старый draft #283 обновить на актуальной базе отдельным PR.
#234: managed backups/PITR, сохранённый restore drill и измеренный RPO/RTO; владелец DB/SRE.
#236: authenticated smoke/ramp/spike/soak и деградация; владелец performance/SRE.
#256/#257/#237: доступы, независимый pentest и внешнее security acceptance; владелец security/repository owner.
#241: controlled pilot, telemetry, support/incident runbook, legal/privacy approval; владелец product/operations с соответствующими специалистами.

Роли владельцев указаны как требуемая ответственность, не как подтверждённое назначение конкретного человека. Ни один внешний блокер не закрывается только репозиторным CI.

## 4. Приёмка полного продукта

G01 самостоятельный ремонт; G02 один подрядчик; G03 независимые подрядчики; G04 нестабильная связь; G05 смена аккаунта; G06 финансовая сверка; G07 документы/подпись/native-файл; G08 сдача/гарантия/архив/purge; G09 эксплуатационный инцидент; G10 small-screen/accessibility/deeplink. Определения и ожидаемые результаты находятся в полном аудите.

Для каждой функции зафиксировать requirement ID → entry route → role → API/service → authoritative entity → transaction/idempotency → side effect → read/UI → test ID → exact run/artifact. Пустой test/evidence — непроверенная функция, не DONE. Source contract не заменяет поведенческий тест.

## 5. Исторические контрольные заголовки

Следующие заголовки сохранены для совместимости source-contract и исторической прослеживаемости. Они не возвращают уже исправленные проблемы в активную очередь.

### P0.1. Закрыть canonical local runtime end-to-end
DONE в пределах #288/CI; external runtime остаётся отдельным #233.

### P0.2. Полная native PostgreSQL enum parity
w16legacystatus01 → w17chatmessageenum01 → w18nativeenumparity01 интегрированы. Любая новая migration требует новой PostgreSQL/schema qualification; это не вечно зелёный сертификат.

### P1.1. Полный screen contract inventory
ACTIVE: текущий каталог и registry — исходный inventory, а не доказательство прохождения каждого действия. Добавить dynamic/deeplink/role-specific/hidden, native exports и error/recovery состояния. #305/#300/#315/#317/#320.

## 6. Журнал этого аудита

Выявлены и зарегистрированы #316–#320; расширены #315 и #305 конкретными исходными цепочками. Синхронизируются текущий паспорт, roadmap, реестр расчётов, readiness и строгая проверка заголовка схемы. Производственные дефекты этими документами не исправлены; их статус SOURCE CONFIRMED / OPEN. Старые source snapshots сохраняются в history без использования как текущего launch verdict.

Субъективный процент готовности и календарный ETA не рассчитываются без весов требований, принятого release scope, команды и внешних условий. Закрытие реальных приёмочных критериев важнее числа новых функций.


## 7. Action OS responsibility progression — 2026-10-10

Canonical sequence:

`Action Responsibility v1 -> Home/Repair/Object/Budget responsibility surfaces -> Action Queue v2 -> parallel responsibilities -> escalation -> SLA routing`.

Current evidence:
- Action Queue v2 admitted on exact head `2d70b9542fd18b1f460e778b800f61963eaed294`: policy, mobile typecheck/contracts, backend-complete, Golden Paths, Playwright, participant PostgreSQL, security operations and technical-spec integrity GREEN.
- Parallel responsibilities is ADMITTED on exact head `965e5e856d6474ea0c2cd684a2c5ff408b89d844`: policy, mobile/typecheck, backend-complete, Golden Paths, Playwright, participant PostgreSQL, technical supervision, security operations and technical-spec integrity GREEN.
- Escalation v1 is ADMITTED on exact head `72674acc7377f844fa86c3ace40421b8d55bb17a`: policy, technical specification, security operations, participant PostgreSQL, mobile/typecheck, technical supervision, production readiness, Golden Paths, Playwright and backend-complete GREEN.
- SLA routing v1 is ADMITTED on exact head `ade615bc0d144bbb7fdfb1b8194fffda1d94c61e`: policy, technical specification, security operations, participant PostgreSQL, mobile/typecheck, technical supervision, production readiness, Golden Paths, Playwright and backend-complete GREEN.
- SLA routing remains a read-only projection over existing canonical `due_at` deadlines and admitted escalation signals. Before breach, the route stays with the current responsible actor. After breach, it follows the admitted escalation target when one exists; owner-owned breaches remain with the owner. It does not create timers, reassign work, mutate deadlines or send notifications.
- No generic “due soon” threshold is invented. Existing domain-specific reminder semantics such as the rework 24-hour reminder remain authoritative and separate.

Evidence boundary: any next Action OS layer must preserve this read-model/authority separation and receive its own exact-head admission.


### Blocked Work / Handoff v1

Next bounded Action OS layer after admitted SLA routing:

- source authority remains `Stage`, `WorkDependency`, `MaterialPick` and existing dependency/supply services;
- only stages visible under the existing project-detail visibility contract are projected;
- dependency evaluation is read-only: `commit=False, persist_status=False`;
- work blockers route to the current canonical actor of the predecessor stage; predecessor in review routes to owner acceptance;
- material blockers route first to owner approval when the pick is not approved/purchased, then to the canonical supply side from `supply_source`;
- `third_party` stays an external handoff and does not manufacture a Renova user;
- a visible stage depending on a hidden sibling stage exposes only neutral `Ждёт предыдущую работу`: no sibling title, ref ID or actor metadata;
- no blocker mutation, waiver, dependency rewrite, assignment change or purchase/acceptance command is introduced by this read model.

Status: IMPLEMENTED / EXACT-HEAD QUALIFICATION REQUIRED. No successor Action OS layer may be added until this slice is GREEN.

### Blocked Work / Handoff v1 — human UX regression fix

Observed: Home Action Queue was hidden when `ResponsibilityQueue.count == 0` despite existing `blocked_work.items`; the user could not see why an otherwise action-free stage was blocked. Fixed with a shared presentation predicate, and handoff `decide_work_acceptance` now enters canonical Repair / Control rather than the general Works tab. Added `actionQueuePresentation.test.ts` to the blocking `mobile:test` suite. Implementation is **QUALIFICATION REQUIRED** on its own exact head; no new blocker authority or mutation is introduced.

### Blocked-only human UX — qualification candidate

When only blocked work is present, Home hides six misleading zero counters and presents the work blocker as the primary context. A handoff is labelled as the current user's next step only when the canonical handoff_user_id matches the active user; hidden/external blockers never disclose actor metadata. This is presentation-only, with blocking mobile regression tests. Status: IMPLEMENTED / EXACT-HEAD QUALIFICATION REQUIRED.

### Cross-role Blocked Work / Handoff — executable E2E qualification

One fresh real API project now exercises lead dependency configuration, principal-specific blocked-work responsibility, denial of premature stage start, signed contract, stage evidence/checklist, first submission, owner review and return, continued dependency block during rework, resubmission, owner acceptance, automatic blocker disappearance and **explicit** successor start. An unrelated guest is denied the responsibility projection. New `e2e/blocked-work-handoff-lifecycle.spec.ts` is included in the required `scripts/ci-playwright.sh api` suite; implementation is **QUALIFICATION PENDING** until exact-head Playwright, backend, Golden, security, mobile and specification gates pass.

### Rework issue reviewer verification — 2026-10-11

Observed business gap after cross-role E2E admission `53054823a115576af7458b9160302fe16136227d`: a medium-severity issue created specifically by acceptance return could be marked `fixed` by the contractor, re-submitted, then accepted while that exact issue was not yet independently verified. This is distinct from ordinary medium warnings.

Bounded fix: canonical `finalize_work_acceptance` (app and portal entrypoints) blocks accepted state with `rework_issue_verification_required` while any issue linked by the durable `rework-issue-{id}` checklist marker is not `closed`. Submission for review remains allowed; only the authorized reviewer can close the issue. A contractor `fixed` status is never equivalent to reviewer confirmation. Normal medium/low unrelated warnings retain their existing semantics. API E2E and backend negative contract updated; exact-head CI/security/spec/participant evidence is **PENDING**, not admitted.

### Qualification repair — cross-role rework verification

Exact-head `3a9bbc54941336f294149034dbfcb368e39c020e` was RED: canonical reviewer confirmation gate correctly rejected an old regression journey that omitted `contractor fixed → customer closed`, cascading into payment/closeout/warranty assertions; the newly added backend test read expired SQLAlchemy ORM attributes after a rollback (`MissingGreenlet`). Tests were repaired to exercise the actual two-actor verification and preserve stable scalar IDs across rollback. The production gate is unchanged. New exact-head qualification REQUIRED; no other features admitted yet.
