# Renova — Golden Paths (сквозные сценарии готовности продукта)

**Правило:** продукт считается функционально завершённым, когда каждый GP ниже зелёный в двух формах — API-уровень (`e2e/golden/gp<N>.*.spec.ts`) и mobile-web (`apps/mobile/e2e/golden/gp<N>.*.spec.ts`) — на canonical local runtime (PostgreSQL + Redis + MinIO + API + Worker) с провайдерами в режиме `simulated`.

`simulated` относится только к внешней границе провайдера. Оно **не разрешает** отдельную demo-бизнес-логику, demo-финансовую правду, обход ACL, обход Domain Outbox или упрощённые сценарии. Демонстрация Renova обязана выполнять те же продуктовые маршруты, сервисы, транзакции, read-model и recovery-механику, которые использует обычное приложение; меняется только реализация внешнего порта и контролируемые тестовые данные.

**Роли:** `C` — заказчик, `E1`/`E2` — исполнители, `A` — admin/operator.

**Общие acceptance-правила для всех GP:**
- каждая мутация оставляет запись в audit и, если предусмотрено, событие в Domain Outbox, которое обрабатывается worker-ом (проверяется по состоянию, не по логам);
- каждое изменение, видимое второй стороне, отражается у неё в inbox/уведомлении;
- HTTP-ошибки соответствуют error model `AGENTS.md` §9;
- повторный вызов идемпотентной мутации с тем же ключом не создаёт дубликат;
- критическая пользовательская мутация заканчивается одним явным outcome: `committed`, `queued`, `unknown_needs_reconcile` или `authoritative_refusal`; ошибка последующего refresh/sync не имеет права превращать уже подтверждённый commit в сообщение «не сохранено»;
- при `unknown_needs_reconcile` клиент проверяет авторитетное состояние или повторяет **тот же** сериализованный intent с прежним request identity; новый бизнес-intent не создаётся автоматически;
- session generation проверяется перед каждым publish/navigation/persistent-storage шагом после `await`; старый completion не может публиковать состояние после logout/login или смены аккаунта;
- одинаковый `user_id` после A→B→A не означает прежнюю сессию: старые async completion, refresh-token результат и offline-intent не получают authority новой generation;
- кэшированное чтение сохраняет provenance результата (`asOf`, `fromCache`, `stale`, source/reason); fallback на старый кэш не обновляет timestamp и не становится визуально «свежим»;
- финансовый UI различает `plan`, подтверждённый `fact` и `unavailable/нет детализации`; presentation-агрегация не мутирует `Project.budget_spent`, ledger или иной авторитетный финансовый факт;
- пользовательские экраны критических GP имеют различимые состояния `loading`, `empty`, `error`, `offline`, `stale`, `processing/queued`, `conflict/version`, `access_revoked`, `success`; запрещён optimistic false success;
- право принять финансовое/приёмочное/документное решение определяется серверным ACL/decision-rights, а не наличием кнопки на клиенте; submitter не становится reviewer автоматически;
- browser/mobile-web success не считается доказательством native save/share, secure storage, background lifecycle или физического устройства;
- сценарий воспроизводим на чистой БД без seed (кроме GP-C-*, которые используют seed C1); seed — только подготовка данных, а не специальная бизнес-ветка;
- удаление legacy/redirect/API alias допускается только после доказательства канонического replacement, отсутствия writer divergence и сохранения старых deep-link/contract путей там, где совместимость ещё нужна.

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
7. Существующий путь редактирования комнаты проверяется end-to-end: `RoomDetailScreen` → `PATCH room` → новый snapshot/change-log → явный `calc-materials` → пользователь видит обновлённый расчёт. Сам пересчёт комнаты **не** переписывает молча уже утверждённый бюджет/смету; изменение approved finance проходит свой канонический change/approval path.
8. Периодные/портфельные графики не показываются как достоверный факт, если их агрегация не сохраняет сумму или категория не имеет независимого actual; `unavailable` лучше выдуманного нулевого отклонения (#318).

**Negative:**
- N1: смета без комнат → 422 `rooms_required`, объект не переходит в `estimated`.
- N2: второй пользователь без участия → 404 на `/projects/{id}` (не 403 — не раскрывать существование).
- N3: изменение площади после утверждения бюджета → расчёт материалов обновляется, но approved budget не меняется без отдельного подтверждённого финансового перехода.

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
7. Multi-contractor UX продолжает существующий `ProjectParticipant` foundation, а не расширяет generic project ACL: role/capability + stage/work/room scope задаются явно; sibling contractor не получает чужие finance/docs/chat/admin данные (#300/B1/B2).
8. Удаление/замена участника сохраняет историю назначения/audit; поздний response старой сессии не может вернуть удалённый scope (#315).

**Negative:**
- N1: `E1` и `E2` одновременно принимают один лид (auto-assign) → ровно один `taken`, второй 409 `lead_already_taken` (PostgreSQL race).
- N2: `E2` после отклонения пытается открыть проект → 404.
- N3: `C` удаляет `E1` из проекта → лид можно переоткрыть; история назначений сохранена.
- N4: `E2` имеет scope только этапа 2 и пытается открыть finance/document/thread этапа 1 → 403/404 по каноническому контракту.

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
7. Создание work order и другие offline-replayable POST не считаются завершёнными, пока для конкретного mutation path не доказаны stable request identity + one transaction + same-key replay/conflict semantics (#316).
8. Если перенос сроков включён в конкретный product flow, он должен использовать канонический schedule/date mutation с dependency validation; наличие backend route само по себе не означает готовый пользовательский сценарий.

**Negative:**
- N1: старт этапа 2 до принятия этапа 1 → 409 `dependency_not_satisfied`.
- N2: work order от `E2` на этап `E1` → 403/404 по scope (B1).
- N3: ответ на создание work order потерян после commit → reconcile/replay не создаёт второй work order.

---

## GP4 — Приёмка, доработка, гарантия

**Путь:** `E1` сдаёт этап 1 → `C` возвращает с 2 замечаниями → `E1` исправляет, сдаёт снова → `C` принимает через portal-token без входа → через 30 дней (симулированное время) `C` открывает гарантийный claim → `E1` закрывает.

**Acceptance:**
1. Сдача → `stage_review` со статусом `on_review`; `C` получает push (симулятор) и inbox.
2. Возврат → `rework` с двумя `issues`; `rework_sla` считает дедлайн.
3. Повторная сдача → замечания закрыты, статус `on_review`.
4. Приём через `portal.py` по одноразовому токену: `accepted`, `accepted_at`, подпись акта in_app (GP7-совместимо); токен повторно не работает (410).
5. Гарантийный claim (`WARRANTY-ATOMICITY-CONTRACT`) создаётся атомарно с уведомлением; закрытие — с evidence.
6. На дашборде `C`: прогресс вырос на вес этапа 1; `next action = оплатить этап`.
7. Наличие нескольких совместимых HTTP alias не считается несколькими источниками истины, если они делегируют одному каноническому decision service. Retire/410 применяется только к подтверждённому legacy writer/alias после removal proof; уже делегирующий compatibility route нельзя массово удалять по имени.

**Negative:**
- N1: приём этапа с открытыми issues → 409 `open_issues`.
- N2: portal-token, выданный для проекта A, на проекте B → 404.
- N3: follow-up refresh после успешного `accept/return` падает → UI сообщает «решение сохранено, не удалось обновить данные» и повторяет read/reconcile, а не decision mutation (#305).

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
8. Если используется manual transfer evidence, каноническая цепочка: `C` upload/submit → authorised reviewer (`A` по текущему `require_admin_user`) читает evidence → approve/reject → `C` видит решение → только approve входит в канонический payment/expense transition. Submitter **не** получает self-review только потому, что mobile UI способен показать evidence.
9. Платёжный provider в `simulated` режиме заменяет только внешний порт. Никакой demo shortcut не может напрямую записать succeeded/Expense вне той же provider/webhook/outbox/reconciliation цепочки.
10. До закрытия #318 периодные/портфельные диаграммы не используются как доказательство финансовой истины, если их presentation-агрегация не прошла reconciliation/property tests.

**Negative:**
- N1: webhook с суммой ≠ платежу → `amount_mismatch`, платёж в `needs_reconciliation`, DLQ-запись, admin видит в `outbox-dead-letters`.
- N2: чек с `amount_mismatch` → предупреждение, расход не признан, `receipt_integrity` флаг.
- N3: worker остановлен между webhook и Expense → после старта `provider_reconciliation_worker` доводит до консистентности.
- N4: submitter manual evidence вызывает review без reviewer authority → 403; evidence/payment state не меняется.

---

## GP6 — Материалы: подбор, закупка, цена, поставка, чек

**Путь:** `E1` формирует список материалов по этапу 2 (`material_calculator`) → `C` согласует → `E1` закупает, указывает цену → чек через симулятор ФНС → поставка на объект → расход в бюджете по категории «материалы».

**Acceptance:**
1. Расчёт количеств по площадям комнат совпадает с `calc-engine` (±1 % с учётом запаса).
2. Цена с provenance (`MATERIAL-PRICE-TRUTH-CONTRACT`): источник, дата; исторические неизвестные — quarantined, не выдуманы.
3. Поставка (`MATERIAL-SUPPLY-CONTRACT`): статус `delivered` только с фактом; готовность материалов не стартует этап.
4. Чек привязан к закупке; расход — в бюджете по категории; drill-down до чека с экрана бюджета.
5. После подтверждённого status/purchase commit падение `syncProjectSideEffects`/reload не показывает «статус не изменён»: committed state сохраняется, UI переходит в degraded/read-reconcile outcome (#305).
6. Partial payment и partial delivery — разные доменные понятия; UI/API не выводят одно из другого без отдельного авторитетного факта.

**Negative:**
- N1: закупка без согласования при `budget over threshold` → 409 `approval_required`, change order создан.
- N2: тот же чек на две закупки → dedup 409.
- N3: commit статуса доставки успешен, refresh падает → повторяется read/reconcile, не delivery mutation.

---

## GP7 — Документы: договор, подпись, хранение, экспорт

**Путь:** после GP2 система создаёт черновик договора из шаблона → `C` и `E1` подписывают in_app (симулятор e-sign) → версия зафиксирована → к концу проекта экспорт архива и 1С-выгрузка.

**Acceptance:**
1. Договор — `ProjectDocument` с версией; `document_state_lifecycle_service` переходы `draft → pending_signature → signed`.
2. Две подписи через `esign/registry.get_provider("in_app")`; `signature_idempotency_key` предотвращает дубликат.
3. Изменение документа после подписи → новая версия, старая immutable.
4. Экспорт архива содержит договор, акты приёмки GP4, чеки GP5/GP6, фото GP3; 1С-выгрузка сходится с бюджетом по суммам.
5. `DocumentsHub` показывает статус и «кто должен подписать».
6. Файловый результат различает `bytes_fetched`, `share_presented`, `cancelled`, `share_unavailable`, `completed/retained` по конкретному контракту. Нельзя считать вызов browser `URL.createObjectURL` доказательством native export. Для chat PDF #320 требуется переиспользовать canonical authenticated download/file abstraction, а не создавать отдельный downloader.
7. Expired/revoked session и cross-project ACL проверяются до выдачи содержимого; временный файл старой session generation не открывается новому аккаунту (#315/#320).

**Negative:**
- N1: подпись `E2` (не участник) → 404.
- N2: экспорт проекта без участия → 404.
- N3: native share отменён пользователем → UI не сообщает «файл сохранён» без отдельного подтверждения результата.

---

## GP8 — Коммуникация: чат, inbox, push, напоминания

**Путь:** `C` пишет в тред этапа → `E1` получает push (симулятор) и inbox → отвечает с фото → `C` прочитал (`CHAT-ATOMICITY-CONTRACT`) → automation ставит напоминание о приёмке через 2 дня (симулированное время) → напоминание доставлено один раз.

**Acceptance:**
1. Тред привязан к проекту и scope; `E2` не видит.
2. Push receipt через симулятор → `push_receipt_worker` реконсилирует; невалидный токен удаляется.
3. Read-truth: непрочитанные у `C` = 0 после открытия; equal-timestamp кейс (#271) детерминирован.
4. `automation_reminders_worker`: ровно одно напоминание при повторных прогонах (dedupe).
5. Inbox `/inbox` показывает все attention-элементы GP3–GP7 с deep-link в канонический hub.
6. `thread participants` должны быть достижимы из пользовательского контекста там, где управление/понимание участников влияет на multi-contractor flow; отсутствие отдельной строки API-helper не трактуется автоматически как отсутствие UX без трассировки экрана.
7. Для ordinary message/receipt enqueue применяется транспортная классификация #317: authoritative 4xx не ставится в очередь, ambiguity/network/timeout ставится только если target mutation replay-safe; сериализованный intent и request identity сохраняются.

**Negative:**
- N1: сообщение от `E2` в тред `E1` → 403/404.
- N2: Redis недоступен → сообщение сохранено в БД, доставка догоняется после восстановления (WS bridge).
- N3: сеть пропала после server commit, но до получения HTTP response → safe replay/reconcile возвращает исходный результат и не создаёт второй message/task/payment.

---

## Cross-cutting recovery — обязательны до функциональной завершённости

### G04 — Нестабильная связь и потеря ответа

Проверяется минимум на chat message, chat task/invoice, receipt/evidence и одном нефинансовом project mutation.

**Acceptance:**
1. До первого send сформирован стабильный intent/request identity там, где операция replayable.
2. `network/timeout/response-loss` не смешивается с authoritative 4xx/409.
3. `queued` означает durable local queue, а не завершённую серверную операцию.
4. Response loss после commit → тот же intent возвращает исходный authoritative result.
5. Offline queue переживает restart; при logout/account switch job не выполняется под чужим bearer.
6. Cache fallback явно `stale` и сохраняет исходный `asOf`.

### G05 — Смена аккаунта/сессии A→B→A

**Acceptance:**
1. Каждый login/session replacement увеличивает session generation.
2. Logout немедленно инвалидирует локальную authority и очищает/изолирует чувствительное состояние; серверный `/auth/logout`/refresh-session revoke выполняется канонически, если сеть доступна. При offline logout UI не заявляет, что server revoke подтверждён.
3. Поздние ответы пользователя A после входа B не меняют projects, activeProject, inbox, navigation, token storage или queue state.
4. A→B→A создаёт новую generation; completion из первой A не принимается.
5. Refresh-token response старой generation не заменяет токены новой.
6. Offline jobs имеют owner/session provenance; чужой bearer не используется для replay.
7. Rate limit/storage failure/cancelled request имеют явный outcome и не маскируются как успешный load.

---

## UX proof для Golden Paths

Для каждого пользовательского экрана GP1–GP8 screenshot/interaction evidence должен покрывать применимые состояния: `loading`, `empty`, `error`, `offline`, `stale`, `processing/queued`, `conflict/version`, `access_revoked`, `success`. Проверяется не только внешний вид, но и доступность действия: финансовое/approval действие на stale/unknown state должно fail closed.

Mobile-web screenshot на размере iPhone является browser evidence. Native iOS/Android save/share, secure-storage lifecycle, background/foreground и OS-level permission behavior требуют отдельного device evidence и не повышаются автоматически до `NATIVE VERIFIED`.

UI-kit/route cleanup оценивается по результату: один канонический hub/action, понятная навигация, touch/accessibility contract и отсутствие proven duplicate writer/view. Число registry routes, `<Pressable>` или hex-строк само по себе не является Definition of Done; новые прикладные экраны обязаны использовать существующие Theme/tokens/shared primitives по `AGENTS.md`.

---

## Статус (обновляется в каждом PR, меняющем GP)

| GP | API | mobile-web | Блокирует | Последний PR |
|---|---|---|---|---|
| GP1 | ❌ not written | ❌ | A1, #318 | — |
| GP2 | ❌ | ❌ | A1, B1–B5, #300 | — |
| GP3 | ❌ | ❌ | A1, B1, #316 | — |
| GP4 | ❌ | ❌ | A1, C5, #305 | — |
| GP5 | ❌ | ❌ | A1, A3–A5, #316, #318 | — |
| GP6 | ❌ | ❌ | A1, A5, #305 | — |
| GP7 | ❌ | ❌ | A1, A6, C6, #320 | — |
| GP8 | ❌ | ❌ | A1, A6, #317 | — |
| G04 | ❌ | ❌ | #316, #317 | — |
| G05 | ❌ | ❌ | #315 | — |

Легенда: ❌ not written · 🔴 written, failing · 🟡 passing on SQLite/local only · 🟢 passing on PostgreSQL topology in CI.
