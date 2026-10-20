# Renova — Golden Paths (сквозные сценарии готовности продукта)

### C8 / #753 — versioned presentation capture (2026-10-19 candidate)

Follow-up source audit records #755: the existing PostgreSQL refund race covers
one payment, while shared-project budget totals across different concurrently
refunded payments require a deterministic PostgreSQL reproduction. This is a
source risk, not a confirmed production incident. Finance/backend engineering
must prove ledger/aggregate convergence before broader financial qualification.
Capture filenames use `.capture.ts` so generic `e2e/playwright.config.ts` discovery
does not accidentally run presentation cases without their capture environment.

Independent source review found that generic shell text could admit a loading or
error screen. Capture readiness therefore requires exact loaded estimate totals,
the budget summary hero, and an API-derived stage name on its scoped stage filter;
seeded estimate lines and an unfinished stage must exist. Explicit loading/error
states and dependency-check failures reject a scene before its manifest is written.

After the existing API and mobile-web Golden gates pass, the same canonical local
runtime stays alive for `e2e/presentation/product-tour.capture.ts`. The capture uses
existing in-memory demo auth fixtures, customer/contractor roles, 390×844 and
1440×900 viewports, and actual estimate, budget and execution routes. It produces
12 PNGs and four 25-second H.264 MP4 clips when all four cases succeed. Each case
writes a SHA/run/role/viewport/asset-hash manifest only after render, crash and
duration checks pass. Encoding keeps real frames without looping or padding.

The existing CI Golden job retains `presentation-media/` for 90 days, including
partial output on failure for diagnosis. Raw recordings, auth storage state and
traces are excluded. A folder without its manifest is incomplete. A passing
manifest still has `visualReview=PENDING`: inspect every PNG/MP4 before selecting
landing-page assets. This is a seeded local screen tour, not a proof of every
click, real payment/provider delivery, staging or production. Golden assertions
and release gates remain mandatory and unchanged. Full GP5 action acceptance
remains #734. Fresh exact-head CI and visual review must qualify this candidate.

Baseline #752 at `15cc78b1506d66ad055fe27b72f5418511264848`: CI 39162130378
completed successfully; backend log reports 1864 passed / 32 skipped; PostgreSQL
partial-refund concurrency 1 passed, schema drift 2 passed. These results qualify
that parent only. This session lacks the canonical Docker/Poetry/Node20 runtime;
local doctor/check/test-full and capture are not executed. New capture runtime
evidence remains pending until its own CI artifacts exist and are viewed.

**Правило:** продукт считается функционально завершённым, когда каждый GP ниже зелёный в двух формах — API-уровень (`e2e/golden/gp<N>.*.spec.ts`) и mobile-web (`apps/mobile/e2e/golden/gp<N>.*.spec.ts`) — на canonical local runtime (PostgreSQL + Redis + MinIO + API + Worker) с провайдерами в режиме `simulated`.

**Роли:** `C` — заказчик, `E1`/`E2` — исполнители, `A` — admin/operator.

**Общие acceptance-правила для всех GP:**
- каждая мутация оставляет запись в audit и, если предусмотрено, событие в Domain Outbox, которое обрабатывается worker-ом (проверяется по состоянию, не по логам);
- каждое изменение, видимое второй стороне, отражается у неё в inbox/уведомлении;
- HTTP-ошибки соответствуют error model `AGENTS.md` §9;
- повторный вызов идемпотентной мутации с тем же ключом не создаёт дубликат;
- сценарий воспроизводим на чистой БД без seed (кроме GP-C-*, которые используют seed C1).

---

## GP1 — Заказчик: объект, планировка, смета, бюджет

**Путь:** `C` регистрируется по OTP (симулятор SMS) → создаёт проект → добавляет 3 комнаты с площадями → выбирает шаблон ремонта из `calc-engine/templates` → получает смету → утверждает бюджет.

**Acceptance:**
1. OTP получен из `dev_outbound_messages`, вход успешен, refresh-token работает.
2. Проект создан через `project_creation.py` (не legacy writer); `Project.owner_id = C`.
3. Комнаты сохранены; `room_snapshot_service` отдаёт консистентный снимок.
4. Смета из `estimate_service` совпадает с расчётом `packages/calc-engine` на тех же входах (±0.01 ₽) — тест сравнивает оба.
5. Бюджет `plan = Σ estimate lines`; `budget.tsx` показывает то же число.
6. Дашборд показывает 0 % прогресса, план бюджета, `next action = найти исполнителя`.

**Negative:**
- N1: смета без комнат → 422 `rooms_required`, объект не переходит в `estimated`.
- N2: второй пользователь без участия → 404 на `/projects/{id}` (не 403 — не раскрывать существование).

---

## GP2 — Маркетплейс: лид, 2–3 предложения, выбор, назначение

**Путь:** `C` публикует лид по проекту GP1 → `E1` и `E2` видят лид в `job-leads` → оба отправляют КП (цена, сроки) → `C` сравнивает → выбирает `E1` → `E1` проходит `contractor-wizard/[leadId]` → становится lead-исполнителем с `scope = full`.

**Acceptance:**
1. Лид виден только исполнителям с активным статусом НПД (`simulated npd = active`); `E3` с `inactive` не видит.
2. Два КП сохранены; у `C` экран сравнения показывает обе с итогами.
3. Выбор `E1` → `marketplace_conversion_service` в одной транзакции: `JobLead.status = taken`, `ProjectParticipant(E1, lead, active)`, КП `E2` → `declined`, `E2` получает уведомление.
4. Повторный вызов конверсии с тем же idempotency-key → тот же результат, без дубликата участника.
5. У `E1` проект появился в «мои проекты»; у `E2` — нет.
6. Лимит `contractor_free_project_limit` учтён (B4): если у `E1` уже 1 бесплатный проект — 409 `contractor_capacity_exceeded` с подсказкой о подписке.

**Negative:**
- N1: `E1` и `E2` одновременно принимают один лид (auto-assign) → ровно один `taken`, второй 409 `lead_already_taken` (PostgreSQL race).
- N2: `E2` после отклонения пытается открыть проект → 404.
- N3: `C` удаляет `E1` из проекта → лид можно переоткрыть; история назначений сохранена.

---

## GP3 — Исполнитель: этапы, график, старт, work order, отчёт

**Путь:** `E1` формирует этапы из сметы (или принимает предложенные) → график с зависимостями → `C` согласует → `E1` явно стартует этап 1 (`STAGE-START-AUTHORITY-CONTRACT`) → создаёт work order → загружает 3 фото → отмечает 60 % готовности.

**Acceptance:**
1. Этапы связаны с позициями сметы; сумма весов = 100 %.
2. График: зависимость этап2 → этап1; дата старта этапа 2 не раньше окончания этапа 1; `calendar_integrity_service` без нарушений.
3. Согласование графика `C` → `approval_decision_service`; без согласования старт этапа → 409 `schedule_not_approved`.
4. Старт этапа — явное действие; готовность материалов не стартует этап (см. контракт).
5. Фото загружены в MinIO через `media.py`; `document_media_acl`: `C` видит, `E2` (не в scope) — 404.
6. Прогресс на дашборде `C` обновился; уведомление «этап начат» в inbox `C`.

**Negative:**
- N1: старт этапа 2 до принятия этапа 1 → 409 `dependency_not_satisfied`.
- N2: work order от `E2` на этап `E1` → 403/404 по scope (B1).

---

## GP4 — Приёмка, доработка, гарантия

**Путь:** `E1` сдаёт этап 1 → `C` возвращает с 2 замечаниями → `E1` исправляет, сдаёт снова → `C` принимает через portal-token без входа → через 30 дней (симулированное время) `C` открывает гарантийный claim → `E1` закрывает.

**Acceptance:**
1. Сдача → `stage_review` со статусом `on_review`; `C` получает push (симулятор) и inbox.
2. Возврат → `rework` с двумя `issues`; `rework_sla` считает дедлайн.
3. Повторная сдача → замечания закрыты, статус `on_review`.
4. Приём через канонический `portal_acceptance_decisions.py`: write-токен должен иметь активную registry-bound PortalLink с `accept_stage`; отозванная/просроченная/legacy jti-less ссылка не допускается (410), попытка другого проекта маскируется (404), повтор решения по уже принятой/устаревшей приёмке возвращает 410. Кандидат #676 добавляет одноразовое `accept_stage` в транзакцию канонической приёмки; до PostgreSQL race/full CI право **не квалифицировано**. Право на `read/pay/sign_document` сохраняется. Повтор и параллельные решения должны получать терминальный 410 и не создавать вторичных событий. Подписание акта и warranty требуют отдельной полной GP4 квалификации (#734).
5. Гарантийный claim (`WARRANTY-ATOMICITY-CONTRACT`) создаётся атомарно с уведомлением; закрытие — с evidence.
6. На дашборде `C`: прогресс вырос на вес этапа 1; `next action = оплатить этап`.

**Negative:**
- N1: приём этапа с открытыми issues → 409 `open_issues`.
- N2: portal-token, выданный для проекта A, на проекте B → 404.

---

## GP5 — Деньги: счёт, оплата, чек, расход, спор, возврат

**Путь:** этап 1 принят → `E1` выставляет счёт → `C` оплачивает через симулятор платежей (страница оплаты → «Оплатить») → webhook `succeeded` → `E1` прикладывает QR-чек (симулятор ФНС `valid`) → расход в бюджете → `C` открывает спор на часть суммы → `A`/`E1` делает частичный возврат → бюджет скорректирован.

**Acceptance:**
1. `payment_checkout_service` вызывает `registry.payment_provider()`, не `yookassa_service`.
2. Страница `payment-return.tsx` в режиме `simulated` показывает кнопки `Оплатить / Отменить`; нажатие вызывает dev-transition endpoint, который генерирует webhook в **тот же** `/payments/webhook` путь.
3. Webhook → `process_webhook` → outbox `PaymentSucceeded` → worker → `Expense` recognized (`MANUAL-PAYMENT-EVIDENCE-CONTRACT`: одна Payment → одна Expense).
4. Дубликат webhook → `already_processed`, без второй Expense.
5. Чек: QR → `fiscal_receipt_provider().verify()` → `fns_verified = true`; `fiscal_receipt_dedup_service` отклоняет тот же чек второй раз.
6. Бюджет `fact = Σ recognized expenses`; на экране совпадает.
7. Спор → `payment_dispute_service`; частичный возврат → `payment_reversal_service` → `RefundSucceeded` → Expense скорректирован; `payment_history` показывает полную цепочку.

**Negative:**
- N1: webhook с суммой ≠ платежу → `amount_mismatch`, платёж в `needs_reconciliation`, DLQ-запись, admin видит в `outbox-dead-letters`.
- N2: чек с `amount_mismatch` → предупреждение, расход не признан, `receipt_integrity` флаг.
- N3: worker остановлен между webhook и Expense → после старта `provider_reconciliation_worker` доводит до консистентности.

---

## GP6 — Материалы: подбор, закупка, цена, поставка, чек

**Путь:** `E1` формирует список материалов по этапу 2 (`material_calculator`) → `C` согласует → `E1` закупает, указывает цену → чек через симулятор ФНС → поставка на объект → расход в бюджете по категории «материалы».

**Acceptance:**
1. Расчёт количеств по площадям комнат совпадает с `calc-engine` (±1 % с учётом запаса).
2. Цена с provenance (`MATERIAL-PRICE-TRUTH-CONTRACT`): источник, дата; исторические неизвестные — quarantined, не выдуманы.
3. Поставка (`MATERIAL-SUPPLY-CONTRACT`): статус `delivered` только с фактом; готовность материалов не стартует этап.
4. Чек привязан к закупке; расход — в бюджете по категории; drill-down до чека с экрана бюджета.

**Negative:**
- N1: закупка без согласования при `budget over threshold` → 409 `approval_required`, change order создан.
- N2: тот же чек на две закупки → dedup 409.

---

## GP7 — Документы: договор, подпись, хранение, экспорт

**Путь:** после GP2 система создаёт черновик договора из шаблона → `C` и `E1` подписывают in_app (симулятор e-sign) → версия зафиксирована → к концу проекта экспорт архива и 1С-выгрузка.

**Acceptance:**
1. Договор — `ProjectDocument` с версией; `document_state_lifecycle_service` переходы `draft → pending_signature → signed`.
2. Две подписи через `esign/registry.get_provider("in_app")`; `signature_idempotency_key` предотвращает дубликат.
3. Изменение документа после подписи → новая версия, старая immutable.
4. Экспорт архива содержит договор, акты приёмки GP4, чеки GP5/GP6, фото GP3; 1С-выгрузка сходится с бюджетом по суммам.
5. `DocumentsHub` показывает статус и «кто должен подписать».

**Negative:**
- N1: подпись `E2` (не участник) → 404.
- N2: экспорт проекта без участия → 404.

---

## GP8 — Коммуникация: чат, inbox, push, напоминания

**Путь:** `C` пишет в тред этапа → `E1` получает push (симулятор) и inbox → отвечает с фото → `C` прочитал (`CHAT-ATOMICITY-CONTRACT`) → automation ставит напоминание о приёмке через 2 дня (симулированное время) → напоминание доставлено один раз.

**Acceptance:**
1. Тред привязан к проекту и scope; `E2` не видит.
2. Push receipt через симулятор → `push_receipt_worker` реконсилирует; невалидный токен удаляется.
3. Read-truth: непрочитанные у `C` = 0 после открытия; equal-timestamp кейс (#271) детерминирован.
4. `automation_reminders_worker`: ровно одно напоминание при повторных прогонах (dedupe).
5. Inbox `/inbox` показывает все attention-элементы GP3–GP7 с deep-link в канонический hub.

**Negative:**
- N1: сообщение от `E2` в тред `E1` → 403/404.
- N2: Redis недоступен → сообщение сохранено в БД, доставка догоняется после восстановления (WS bridge).

---

## Статус и границы доказательства (сверено 2026-10-16)

**Точная проверенная версия:** PR #731, commit `a0669f2b64ba4e76f3446ae7fd8b399bbd813a04` (не `main`).
[CI run 38763775007](https://github.com/PetrFedin/renova/actions/runs/38763775007): blocking `golden-paths` SUCCESS, API **12/12 passed**, mobile-web **8/8 passed**, тот же API container без рестартов. Полный backend: **1837 passed, 30 skipped**; Playwright API **7/7**, UI **67/67**, skipped/flaky **0**. Это квалификация именно указанных исполняемых тестов на указанном commit, **не** production/staging evidence и **не** автоматическое выполнение всех требований этого документа.

| GP | API Golden на #731 | mobile-web Golden на #731 | Полный контракт выше | Следующее доказательство |
|---|---|---|---|---|
| GP1 | 🟢 2/2 | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | Проверить полный OTP/refresh, calc-engine parity и ввод/утверждение через интерфейс |
| GP2 | 🟢 2/2 | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | UI сравнения/выбора, повтор конверсии, конкурентная гонка и удаление участника |
| GP3 | 🟢 2/2 | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | График с зависимостями и согласованием, MinIO/ACL, события и уведомления |
| GP4 | 🟢 1/1, rework 409 → verify → accept | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | Проверить atomic consume #676 в PostgreSQL race, warranty и UI-действия; #734 |
| GP5 | 🟢 2/2, manual payment evidence/dispute | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | Checkout/provider webhook → worker/outbox → refund, mismatch и recovery |
| GP6 | 🟢 1/1 | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | Цена/provenance, calc parity, чек-dedup, change order и бюджетный drilldown |
| GP7 | 🟢 1/1 | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | Подпись обеих сторон через UI, архив с evidence, ACL и версия документа |
| GP8 | 🟢 1/1 | 🟢 1/1, UI smoke | ⚪ Не подтверждён полностью | Push receipt/worker, read-truth, recovery, automation dedupe через UI/DB |

**Трактовка:** 🟢 означает, что перечисленные тесты прошли на exact commit; `UI smoke` означает загрузку role-scoped страниц и проверку текста, **не** нажатие критических action-кнопок и подтверждение durable result. ⚪ означает, что *полнота coverage относительно критериев выше* ещё не доказана; это не утверждение, что соответствующая функция отсутствует или не работает.

**Обязательное продолжение:** [#734](https://github.com/PetrFedin/renova/issues/734) — contract-to-E2E coverage по всем 8 GP; [#730](https://github.com/PetrFedin/renova/issues/730) — общий интеграционный контур; [#685](https://github.com/PetrFedin/renova/issues/685) — независимое ревью; [#247](https://github.com/PetrFedin/renova/issues/247) — bypass policy. Запрещено повышать статус до полного `Golden Paths DONE`, `STAGING VERIFIED` или `PRODUCTION VERIFIED` до отдельных соответствующих доказательств. `main` и deployment этим доказательством не обновляются.

### GP4 — квалификация гарантийного цикла на обновлённой базе (#734)

Кандидат API Golden теперь проверяет после принятия работ создание гарантийного обращения и документа, идентичный повтор (одна запись), конфликт изменённых данных, разделение прав заказчика/исполнителя, ремонт и подтверждение, idempotent close, архив документа и повторное открытие с возвратом черновика. Перенесён из #738 на базу с исправленной PostgreSQL-фикстурой и цепочкой безопасности #737–#741. **Только новый exact-head CI** подтверждает выполнение этой проверки; пока статус FULL GP4 и браузерного сценария остаётся OPEN. Временной переход на 30 дней, уведомления реальному клиенту и внешние подписи не подтверждены.

### GP5 — dispute expense truth / 2026-10-17 кандидат

После подтверждённого ручного платежа расход имеет `status=confirmed`. Подача спора переводит *тот же* расход в `status=disputed`, сохраняя сумму и ссылку на payment; ответ подрядчика `contest` не означает разрешения спора и не должен молча возвращать `confirmed`. Golden GP5 дополнен API readback по платежам и расходам после ответа подрядчика, с проверкой одной записи и неизменной суммы. Это проверка статусов и связей, **не** GP5 webhook/refund-provider E2E. До exact-head CI статус кандидата PENDING; полный финансовый сценарий остаётся OPEN.

### GP5 — settlement receipt retry / 2026-10-18 кандидат, #744

Предыдущий кандидат #743 (`e5b53fac00be996614aafb3f838a94da445f65bb`) получил CI SUCCESS: run `39043170983`, включая backend-complete, golden-paths и playwright-api-and-ui. Это доказательство только указанного кандидата, не интеграции в main или production.

Обнаружен и воспроизведён дефект обеих receipt routes: первая отправка покрывающего чека переводит `paid_unverified` в `confirmed`, после чего прежняя проверка допустимости прикрепления блокирует даже идентичный повтор с тем же `client_request_id`. Исправление сохраняет актуальный project/payment/customer ACL **до** чтения idempotency ledger; только после отсутствия committed replay проверяет допустимость новой записи. Изменённый payload возвращает `409 idempotency_conflict`, новый ключ на подтверждённом платеже — `409 payment_receipt_not_attachable`. Повтор не является новой оплатой или новой фискальной проверкой.

`test_payment_lifecycle_wave1.py::test_settlement_receipt_replays_after_payment_confirmation[manual|scan]`: до исправления 2 failed (ожидаемый 200, фактический 409); после — в составе 35 passed focused receipt/payment regression. Доказаны прежний receipt ID, один прежний expense ID, сумма 5000 и неизменный budget_spent, отказ получателю и cross-project 404. Локальная проверка использует locked dependencies и SQLite; это не PostgreSQL concurrency proof. Docker отсутствует, canonical local runtime и full runtime здесь не запускались. Новый exact-head CI обязателен.

API Golden GP5 дополнен повтором receipt после подтверждения и сравнением expense ID до/после спора. Количество считается по всем расходам этого payment, без фильтра по статусу, чтобы дубликат с другим статусом не скрывался. Checkout → webhook → outbox → partial refund, конкурентные возвраты, браузерные действия обеих ролей и внешний provider proof остаются OPEN (#734/#730/#238). Полная визуальная оценка шрифтов, отступов и экранов требует исполняемой сборки; этот финансовый ремонт не квалифицирует визуальный слой.


### GP5 — защита от потери webhook частичного возврата, #748 (кандидат 2026-10-18)

**Подтверждённое ограничение продукта:** канонический `payment_reversal_service.apply_provider_refund` пока учитывает **полный** возврат проектного платежа. При частичном `refund.succeeded` он возвращает `handled=False, reason=partial_refund_unsupported`, не изменяя исходные `Payment`, `Expense`, `Project.budget_spent`. Это корректный отказ от ложного бухгалтерского состояния, но раньше canonical `subscription_integrity` мог завершить delivery как `ignored` с успешным HTTP-ответом, несмотря на уже состоявшееся движение денег у провайдера.

Исправление-кандидат A1 обеспечивает два барьера:
- при внешнем partial refund webhook — **не 2xx**, а retryable durable delivery / HTTP 503 с `partial_refund_unsupported`, не помечая событие `completed`; последующая ручная/провайдерная реконсиляция остаётся обязательной (#238). Попытки ограничиваются существующей политикой webhook delivery, а не бесконечной самодельной петлёй;
- локальный simulated-provider control сначала проверяет сумму **именно для project_payment** и отклоняет неподдерживаемый partial refund с 409 до изменения simulated provider balance. Подписочные частичные возвраты используют отдельный subscription ledger и сохраняют прежние правила. Повтор с тем же refund idempotency key, но иной суммой, не допускается.

Тесты связывают реальные boundary-вызовы с целостностью: отсутствие provider money movement при local partial request, 503/deferred event без `PaymentWebhookEvent` и без `PaymentWebhookDelivery.completed_at`, stable refund request identity. Реальное внесение частичного возврата в финансовый журнал, аллокация частей `Expense`, корректировка бюджета, уведомления, реальные провайдеры и браузерный GP5 — **НЕ РЕАЛИЗОВАНЫ данным изменением**; остаются P0 #748/#734/#238. Готовность определяется только новым точным SHA CI. Ни `main`, ни production не обновляются.

### GP5 / C4 — роль и текстовая достоверность расчётов, #746 (кандидат 2026-10-18)

В существующем коде ручной перевод без подтверждения отмечен как `paid_unverified`; покрывающий и не отклонённый чек заказчика может перевести эту оплату в `confirmed` (после отметки перевода), как и подтверждение фактического получения подрядчиком. Недостаточный или отклонённый чек не считается достаточным основанием. Ручной чек при этом не является подтверждением проверки ФНС: отдельно отображается `receipt_unverified`. Проверка загруженного файла банковского подтверждения — отдельный жизненный цикл `PaymentEvidence`, и сам факт загрузки не равен зачислению суммы в подтверждённый бюджет.

Экран `BudgetPaymentsSection` и `PaymentDetailSheet` используют один набор подсказок `paymentSettlementCopy.ts` для обоих участников. Старые формулировки «только после подтверждения получателя» и безусловное «после сканирования подтвердится автоматически» устранены. `paymentUnverified.w143.test.ts` дополняет источник контрактной проверкой реальных связей между компонентами и словарём подсказок. Статус candidate/PR; фактический рендер на физических устройствах, UI-нажатия и сохранённые действия пользователя этим изменением **не квалифицированы** и остаются в #746/#734. `main` и production не изменены.


### GP5 — canonical DB/webhook evidence on the integrated candidate (2026-10-18)

Additional real-service (not monkeypatched) tests assert: (1) external project partial refund event on a confirmed 5 000 ₽ payment receives 503/deferred and stays outside `PaymentWebhookEvent.completed` without altering `Payment`, `Expense`, `Project.budget_spent`, `PaymentEvent` or DomainOutbox; immediate duplicate attempts must also not receive a 2xx completion; (2) full 5 000 ₽ reversal through the **same canonical webhook** yields one `PaymentEvent`, one existing `Expense` marked `refund`, `budget_spent=0`, three notification outbox entries, one completed delivery and an idempotent no-op replay. Both exercise `subscription_integrity.yookassa_webhook` and real `yookassa_service.process_webhook` / `payment_reversal_service` with the database fixture.

Evidence status: **PENDING exact new SHA CI**; SQLite single-session tests do not qualify PostgreSQL concurrency, live-provider reconciliation or the missing partial-money ledger (#748). Full GP5 acceptance stays OPEN; the untouched safety gates and independent review are still mandatory.


### GP5 — cumulative project payment partial refunds (2026-10-18, #748, implementation candidate)

**Financial contract:** `Payment.amount` is the immutable original invoice, not a mutable net balance; `ProjectPaymentRefund` holds one immutable provider refund ID with exact `NUMERIC(14,2)` amount, project/payment/provider binding and unique external refund ID (Alembic revision `x12projectrefund01`, one-head chain). The canonical `subscription_integrity` webhook claims a refund delivery first, then locks the project `Payment`, validates provider identity/currency/positive delta, rejects duplicate-key drift and over-refunds, and appends exactly one refund row, `PaymentEvent`, associated expense net change, budget recalculation and outbox in the same DB transaction as delivery completion. Pending/unverified/cancelled or inconsistent records fail closed. PostgreSQL row locking is authoritative; SQLite tests alone do not prove concurrent delivery safety.

**Amounts:** first 1 000 ₽ return against 5 000 ₽ invoice → `refunded_amount=1 000`, `net_amount=4 000`, one existing `Expense.status=confirmed` with `amount=4 000` and `Project.budget_spent=4 000`. Another 1 500 ₽ → 2 500 ₽ net; final 2 500 ₽ → `Payment.status=refunded`, `Expense.status=refund`, zero net and budget. The same provider event is a no-op replay; a reused provider refund ID with changed payload is rejected. Source hydration (`budget_service.expense_from_payment/receipt`) derives net from the ledger and **must not reconstruct gross** during any budget refresh. Dispute holds the net expense outside confirmed spend; resolution restores only remaining net, not original gross.

**Product/API:** `GET /projects/{project_id}/payments` returns `refunded_amount`, `net_amount`, and provider-refund event amount from the immutable row under project ACL. Both customer/contractor Budget/Payments list and PaymentDetailSheet show gross invoice, returned sum and remainder; PaymentHistory differentiates partial/full events without calling an unverified manual receipt a fiscal verification.

**Provider safety:** local/test simulated provider may generate partial/full project refunds only after verifying its provider ID and metadata against the DB payment; real gateway calls are not added. A webhook whose refund is not bookable is **never 2xx acknowledged**; durable delivery remains retryable/poison-visible with a clear reason for manual reconciliation. Existing Pro-subscription refund accounting remains separate. Actual provider-side refund initiation, rollback of externally completed refunds, dispute arbitration and live financial reconciliation require provider/operator processes (#238).

**Qualification:** source and migration changes are candidate-only until the exact-head full backend, PostgreSQL Alembic/schema checks, payment-checkout contracts, Golden API/mobile-web, Playwright and policy/security CI pass. Real provider callbacks, browser role flows, PostgreSQL concurrency and independent review remain separate proof requirements (#734/#685/#730). No claim of staging, production, provider or main deployment follows from this work.


### GP5 — shared project budget transaction fence / 2026-10-20, #755

**Source risk:** different confirmed project Payments can receive refunds simultaneously. Each payment row is independently locked, but materialized `Project.budget_spent` and BudgetLine actuals belong to the *common project*. Original #752 PostgreSQL race qualified one Payment, not this cross-payment schedule.

**Bounded candidate:** `project_budget_lock.lock_project_budget_projection` obtains PostgreSQL `Project FOR UPDATE` inside the caller transaction, without committing. Refund and dispute writers acquire Payment first, then Project, then linked Expenses and budget projections. Canonical `refresh_budget_facts` and status-preserving expense recalculation use the same project fence. Absent project fails closed. No payment credentials, provider mode, authorizations, refund ledger identity, migrations or mobile screens changed.

**Executable evidence target:** the existing dedicated migrated PostgreSQL refund gate runs `test_project_budget_cross_payment_postgres.py`: two independent confirmed 5 000 RUB payments in one project, simultaneous 1 500 and 2 500 refunds, both immutable provider IDs present once, original Expenses net 3 500 + 2 500, shared Project budget 6 000 and BudgetLine actual total 6 000. Existing same-payment over-refund/replay race remains in the gate. This is **PENDING exact-head CI**, not a passed result. Interleavings with dispute, separate budget refresh and other project budget writers require further PostgreSQL qualification before #755 closure. `main`, staging and production unchanged; full GP5 and independent release review still OPEN (#734/#685/#247).


### GP5 — no estimate rows must not erase visible net Expense budget facts / 2026-10-20 (#755)

Cross-payment PostgreSQL run 39346906329 on **prior** candidate `bf8f1f314425e5ca65e8b056af84c70f23d33438`: complete backend reported **1864 passed, 33 skipped**; dedicated PostgreSQL 1 passed (original same-payment race) and 1 failed (new shared-project test). The confirmed failure was `sum(BudgetLine.actual_amount) == 0` while two confirmed net Expenses and the Project budget projection total were **6 000 ₽** (original two 5 000 ₽ payments, refunds 1 500 + 2 500). This is a concrete budget-drilldown defect in a project **without EstimateLines**, not merely a concurrency hypothesis. A previous failure at the earlier SHA was test fixture FK ordering and was corrected separately.

The follow-up candidate uses `budget_service._reconcile_budget_line_actuals` in `expense_ledger_service.recalculate_existing_expense_facts` (which already serializes on the shared Project row) after estimate synchronization. The canonical projector ensures every active Expense goes once either to one unambiguous estimate line or a marked `[actual-unallocated:...]` line and verifies the projection. **Never call `refresh_budget_facts` here**: it would re-hydrate refunded/disputed source evidence and potentially resurrect reversed expenses. The existing mobile source contract now checks the real canonical path rather than a duplicate simpler algorithm. Repeat exact-SHA backend / PostgreSQL concurrency / Golden / policy CI required. Parent finance merge remains blocked until these complete and independent review succeeds.


**Further explicit concurrency target (after projector repair):** the same dedicated PostgreSQL scenario now also deliberately overlaps a subsequent 500 ₽ refund on the second Payment, customer dispute on the first Payment and a canonical full `refresh_budget_facts` on their shared Project. Expected after all commits: the first Expense is `disputed` at net 3 500 ₽, the second is `confirmed` at net 2 000 ₽, both immutable provider refund rows plus the third refund are present once, `budget_spent` and BudgetLine actuals are **2 000 ₽**. Resolution of the first dispute must restore **3 500 ₽ net**, producing a project/budget-line total of **5 500 ₽**. All these numbers are acceptance assertions **not observed execution outcomes for the new SHA**. SQLite does not qualify this scenario.
