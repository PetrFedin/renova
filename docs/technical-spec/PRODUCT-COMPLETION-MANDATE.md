# Renova — Product Completion Mandate

**Статус:** ACTIVE — единственный приоритетный план работ до отдельного решения владельца.
**Подчинение:** `AGENTS.md` остаётся authoritative engineering context. Этот документ задаёт *что* и *в каком порядке* делать; `AGENTS.md` — *как*. При конфликте формулировок приоритет у `AGENTS.md` и текущего кода/CI; конфликт фиксируется в §9 этого документа, а не решается молча.
**Цель:** довести продукт до состояния **полностью работающего end-to-end для заказчика и исполнителя на симуляторах провайдеров**, с архитектурой, в которую живые ЮKassa/ФНС/Мой налог/Контур/Twilio подключаются добавлением адаптера, без изменения доменного кода.
**Критерий завершения:** все 8 golden paths из `GOLDEN-PATHS.md` зелёные в API- и mobile-web-E2E на canonical local runtime, и `PRODUCTION-READINESS.md` §3 не содержит открытых product-integrity пунктов.

---

## 1. Обязательные правила поведения агента

Эти правила действуют для каждого PR в рамках мандата и не могут быть ослаблены описанием задачи.

### 1.1. Ничего не удалять без доказательства

- Удаление файла, функции, класса, endpoint, route, миграции, теста, workflow, документа или поля модели допускается **только** при выполнении всех условий:
  1. `grep -rn` по всему репозиторию (backend, apps/mobile, e2e, scripts, docs, .github) показывает ноль внешних ссылок, либо каждая ссылка переведена на замену в том же PR;
  2. для кода — есть замена, покрытая тестом, который проверяет то же поведение;
  3. для миграций — удаление запрещено всегда; только новая forward-миграция;
  4. для тестов — тест удаляется только вместе с удалением проверяемого поведения, и это явно названо в PR;
  5. для документов — перемещение в `docs/archive/` с пометкой `HISTORICAL` вместо удаления.
- В описании PR обязателен раздел **`Removal proof`** с выводом grep и ссылкой на заменяющий код. PR без этого раздела при наличии удалений считается не соответствующим DoD.
- Если доказательства ненужности нет на 100 % — не удалять. Оставить, пометить `# LEGACY-RETAINED: <reason> <issue>` и создать issue.

### 1.2. Не ломать зелёное

- Перед началом любой задачи: `npm run dev -- doctor && npm run dev -- check && npm run dev -- test-focused`. Если красное до изменений — сначала issue с фактом, задача не начинается на сломанной базе.
- После изменений: `test-full` + релевантные PostgreSQL integrity workflow. SQLite-прогон не заменяет PostgreSQL-доказательство для concurrency, enum, миграций.
- Локальный `1068 passed` на `main` от 2026-09-08 — baseline. Число прошедших тестов не должно уменьшаться ни в одном PR.

### 1.3. Проверять от начала до конца, а не по месту правки

Для каждой затронутой сущности агент обязан пройти цепочку целиком и зафиксировать её в PR:

`mobile screen → api client (`apps/mobile/lib/api*`) → router (`app/api/v1`) → service → model/migration → outbox handler (если есть) → worker → mobile screen (обратный путь: инвалидация, уведомление, inbox)`.

Разрыв цепочки на любом звене — дефект, даже если тесты зелёные. Найденные по пути дефекты вне задачи фиксируются как issue, не чинятся молча в том же PR (иначе PR становится непроверяемым).

### 1.4. Размер и форма изменений

- Один PR = одна задача из §4 или один именованный подпункт. Не более ~600 строк diff без явной причины.
- Ветка: `agent/<phase>-<task-id>-<slug>` от актуального `main`.
- Название PR: `<type>(<scope>): <task-id> <summary>`.
- В PR обязательны разделы: `What`, `Why (link to mandate task)`, `Chain verified` (§1.3), `Removal proof` (§1.1, или «no removals»), `Evidence` (команды и их результат), `Out of scope / found issues`.

### 1.5. Запрещено

- Подключать реальные ключи провайдеров или менять `production`/`staging` policy на разрешение `simulated`.
- Расширять legacy writers (`project_service.create_project`, `assign_contractor`, `budget_service_legacy`, `[legacyTab]`, finance-center redirects). Только retire по §4.
- Добавлять новые GitHub workflow. Новые проверки — в существующий `ci.yml` или matrix (§4, фаза E).
- Добавлять новые `docs/*.md` вне `technical-spec/` и `archive/`.
- Закрывать issue #300 keyword-ами в PR.
- Использовать `demo`-ветки (`demo=True` в `yookassa_service.create_payment`, `verify_receipt_stub`) как основу симуляторов — они заменяются, не расширяются.

---

## 2. Приоритизация

Порядок фаз фиксирован. Внутри фазы задачи можно параллелить между агентами, если они не трогают одни файлы. Переход к следующей фазе — после закрытия всех `P0` задач текущей.

| Фаза | Цель | Ориентир |
|---|---|---|
| **A. Foundation** | Golden paths как падающие E2E; порты и реестр провайдеров; симуляторы | 1–2 недели |
| **B. Product truth** | #300 полностью; retire legacy writers; capacity/source-transition policy | 2–3 недели |
| **C. Experience** | Realistic seed; дашборд, бюджет, график, документы, empty states; web-демо | 2 недели |
| **D. End-to-end proof** | Все 8 golden paths зелёные API + mobile-web; negative paths | 1 неделя |
| **E. Consolidation** | CI matrix, архив docs, readiness обновлён | 1 неделя |

---

## 3. Определения

- **Port** — `Protocol` в `app/services/providers/base.py`, описывающий внешнюю способность (платёж, чек, статус НПД, подпись, SMS, push, storage). Доменный код зависит только от порта.
- **Adapter** — реализация порта для конкретного провайдера (`adapters/yookassa.py`). Только адаптер знает формат провайдера.
- **Simulator** — реализация порта, которая эмулирует полный жизненный цикл провайдера в памяти/БД, включая входящие webhook в собственную систему через существующий `/webhooks` путь. Запрещён в `production`.
- **Contract test** — параметризованный тест, одинаковый для всех реализаций порта (`tests/providers/test_provider_contracts.py`).
- **Golden path** — сквозной пользовательский сценарий из `GOLDEN-PATHS.md` с acceptance-критериями.
- **Legacy writer** — путь мутации, дублирующий канонический (§13 `AGENTS.md`).

---

## 4. Задачи

Формат: `ID · приоритет · описание · файлы/области · evidence`.

### Фаза A — Foundation

**A1 · P0 · Golden paths как исполняемые контракты.**
Создать `e2e/golden/` с одним Playwright-файлом на каждый путь из `GOLDEN-PATHS.md` (API-уровень) и `apps/mobile/e2e/golden/` (mobile-web). Тесты пишутся сразу по acceptance-критериям и **должны падать** там, где функционал не готов. Каждый тест помечается `@golden` и `@gp<N>`. В `ci.yml` добавляется job `golden-paths`, allowed-to-fail до фазы D.
Evidence: список из 8 тестов с текущим статусом pass/fail и причиной fail для каждого.

**A2 · P0 · Порты провайдеров.**
Добавить `backend/app/services/providers/` из этого пакета (`base.py`, `registry.py`, `errors.py`). Ничего существующего не менять в этой задаче. Прогнать `tests/providers/` на симуляторе.
Evidence: `pytest tests/providers -q` зелёный.

**A3 · P0 · Симулятор платежей.**
`providers/simulated/payment.py` (референс в пакете) довести до полного цикла: `create → pending → (succeed | cancel) → refund`, с генерацией webhook-события во внутренний обработчик через тот же код-путь, что реальный webhook (`payments.py` webhook endpoint → `process_webhook`). Симулятор персистентен в Redis/БД (не только память), чтобы переживать рестарт API и работать из worker.
Admin/dev endpoint `POST /api/v1/dev/providers/payment/{external_id}/transition` (только `local`/`test`, fail-closed в остальных) для управления из E2E и с экрана `payment-return.tsx`.
Evidence: contract test `[simulated]` зелёный; E2E GP5 доходит до `PaymentSucceeded` в outbox и записи `Expense`.

**A4 · P0 · Миграция платежей на порт.**
Перевести `payment_checkout_service.py`, `subscription_checkout_service.py`, `payments.py`, `subscription.py`, `payment_checkout_integrity.py`, `subscription_integrity.py`, `admin.py`, `portal.py`, `staging_readiness.py` с прямого `yookassa_service` на `registry.payment_provider()`. Доменная часть `yookassa_service.py` (event_key, idempotency, money) переезжает в `providers/payments_domain.py`; ЮKassa-специфика — в `providers/adapters/yookassa.py`. `yookassa_service.py` остаётся тонким re-export-слоем с `# LEGACY-RETAINED` до фазы E.
Evidence: `grep -rn "yookassa_service" app --include=*.py` показывает только re-export и адаптер; все существующие `test_yookassa_*`, `test_payment_*`, `test_subscription_*` зелёные без изменений ожидаемых значений.

**A5 · P0 · Симулятор ФНС-чеков и статуса НПД.**
`providers/simulated/fiscal.py`: по QR-строке возвращает детерминированный чек (сумма/ИНН из seed), режимы `valid | not_found | amount_mismatch | timeout | rate_limited` выбираются по маркеру в QR (например, `fp=9999` → not_found). `providers/simulated/npd.py`: статусы `active | inactive | unknown` по ИНН из seed. Заменить `verify_receipt_stub` и текущие `demo`-ветки на вызов порта.
Evidence: contract tests зелёные; `test_fns_*` зелёные; GP5 и GP6 проходят шаг «чек».

**A6 · P1 · Симуляторы уведомлений и подписи.**
SMS: `SimulatedSmsProvider` пишет в таблицу `dev_outbound_messages` (новая миграция) и в лог; E2E читает OTP оттуда вместо чтения из Redis напрямую. Push: аналогично + генерация push receipts для reconciliation worker. E-sign: существующий `in_app` считается симулятором; `external_stub.py` привести к порту.
Evidence: GP8 проходит OTP-вход и получение push через симулятор; `test_otp_*`, `test_push_*` зелёные.

**A7 · P1 · Режимы провайдеров в settings и runtime policy.**
Единая схема `settings.<provider>_mode: off | simulated | real`. `runtime_policy` fail-closed: `simulated` запрещён в `staging`/`production`; `real` без ключей — ошибка старта (как сейчас для kontur). `/health` и `/ready` отдают режим каждого провайдера. Существующие `kontur_mode`, `goskey_mode`, `document_ocr_mode` приводятся к схеме без переименования env-переменных (alias).
Evidence: `test_runtime_preflight_integrity.py` расширен; `staging_readiness` учитывает режимы.

### Фаза B — Product truth (#300 и legacy)

**B1 · P0 · Scoped participant visibility.**
Все read-пути проекта (stages, work orders, schedule, documents, chat threads, notifications, expenses, materials) фильтруются по `ProjectParticipant.scope`. Исполнитель видит только свои этапы/work orders/треды; заказчик — всё. Negative tests: sibling contractor не видит и не может мутировать чужой scope (403/404 по контракту `AGENTS.md` §9).
Evidence: PostgreSQL integrity `project-participant-postgres-integrity` расширен; GP2 и GP3 проходят с двумя исполнителями.

**B2 · P0 · Mobile participant UX.**
Экран участников проекта у заказчика: список, роль, scope, статус лида, приглашение/замена/удаление. У исполнителя: «мои проекты» показывает только назначенные scope-ы, `contractor-wizard/[leadId]` завершает конверсию через канонический `marketplace_conversion_service`. Маршруты — только через `routeRegistry.ts`.
Evidence: mobile-web E2E GP2; typecheck зелёный; `mobile-hub-navigation-integrity` зелёный.

**B3 · P0 · Retire legacy writers.**
`project_service.create_project()` и `assign_contractor()` делегируют в `project_create_service` / `project_assignment_service`; все внутренние/seed/demo вызовы переведены; после этого старые тела функций удаляются по правилу §1.1. `budget_service_legacy.py`: каждая функция сопоставлена с `budget_service` эквивалентом; переведены вызовы; удалено с proof. Mobile: `[legacyTab].tsx` и finance-center redirect — после проверки, что `routeRegistry` не содержит ссылок, и deep-link тесты покрывают старые URL редиректом на канон.
Evidence: `Removal proof` в каждом PR; `test_budget_*`, `test_project_*` без изменений ожиданий.

**B4 · P1 · Contractor capacity policy.**
Единая политика лимита проектов исполнителя как ресурса (`contractor_free_project_limit` и подписка): advisory lock по contractor_id, проверка при create-with-contractor, assign, marketplace conversion, quote accept. PostgreSQL race test: два одновременных assignment на разных проектах одному исполнителю с лимитом 1 — ровно один успешен.
Evidence: новый PostgreSQL integrity test в существующем `project-participant-postgres-integrity` workflow.

**B5 · P1 · Marketplace source transitions.**
Все writers `JobLead` (quote select, auto-assign, conversion, cancel) через один `job_lead_transition_service` с `SELECT ... FOR UPDATE` и явной таблицей допустимых переходов. Race test: два исполнителя одновременно берут один лид — один `taken`, второй `409 lead_already_taken`.
Evidence: PostgreSQL race test; GP2 negative path.

### Фаза C — Experience

**C1 · P0 · Realistic seed.**
`app/dev_seed.py` генерирует «проект в середине жизни»: 3-комнатная квартира с планировкой; 8 этапов (2 accepted, 1 on_review, 1 rework, 2 in_progress, 2 planned); 2 исполнителя с разными scope; 40 позиций сметы из calc-engine templates; 15 платежей (12 с валидными симулированными чеками, 1 без чека, 1 с mismatch, 1 в споре); 3 закупки материалов с ценовой историей; 2 просроченных пункта графика; 3 непрочитанных треда; 1 гарантийный claim; 1 change order на согласовании. Idempotentность seed сохраняется. Все суммы сходятся: план = смета, факт = Σ expenses, отклонение = факт − план по каждой категории.
Evidence: `test_dev_seed_integrity.py` проверяет сходимость сумм и количество сущностей; `npm run dev -- seed` дважды подряд не дублирует.

**C2 · P0 · Дашборд заказчика.**
Главная (`(customer)/(tabs)/index.tsx`): прогресс этапов (accepted/total и по весу сметы), план/факт/отклонение бюджета, ближайшие 3 события (приёмка, платёж, дедлайн), attention-блок из `dashboard_integrity_service` (просрочки, перерасход > threshold, споры, ожидающие согласования). Каждый элемент — deep-link в канонический hub через `routeRegistry`. Данные — с существующих `/os`, `/kpi_history`, `/analytics` эндпоинтов; недостающие агрегаты добавляются в `dashboard_integrity_service`, не в mobile.
Evidence: mobile-web E2E на seed C1 проверяет конкретные числа; screenshot в PR.

**C3 · P0 · Бюджет: план → смета → факт → отклонение.**
`(tabs)/budget.tsx`: сводка по категориям и по этапам, drill-down категория → позиции → платежи → чек (`PaymentDetailSheet`). Индикаторы `budgetThreshold`. Экспорт в PDF через `export.py`. Заказчик и исполнитель видят свою проекцию (исполнитель — только свой scope, B1).
Evidence: числа на экране = числа из `test_dev_seed_integrity`; GP1 и GP5 mobile-web.

**C4 · P1 · График работ.**
`UnifiedScheduleView`: gantt-подобная лента этапов с зависимостями из `dependency_service`, критический путь, просрочки, drag-free (только просмотр + переход в stage). Календарь `/calendar` остаётся hub; ICS-экспорт работает на seed.
Evidence: mobile-web E2E GP3; `calendar-mutation-integrity` зелёный.

**C5 · P1 · Приёмка и гарантия в UI.**
`work-acceptance.tsx`, `quality-control.tsx`, `StageDetailScreen`: полный цикл сдача → принять / вернуть с замечаниями → rework SLA → гарантийный claim; фото-доказательства через `media.py`; портал заказчика (`portal.tsx`) для решения без входа (portal token).
Evidence: GP4 API + mobile-web; `technical-supervision-integrity`, `warranty-claim-postgres-integrity` зелёные.

**C6 · P1 · Документы.**
`DocumentsHub.tsx` (1065 строк) разбить на контейнер + секции без изменения поведения (proof: те же тесты). Цикл договор → версия → подпись in_app обеими сторонами → статус → экспорт архива (`export_archive`) и 1С (`onec_export`).
Evidence: GP7; `document-*` тесты зелёные; diff DocumentsHub — только структурный.

**C7 · P1 · Empty states и первый запуск.**
`ProjectEmptyState.tsx` (465 строк) разбить по ролям/состояниям. Пройти первый запуск обеих ролей с чистой БД (без seed): каждый экран имеет осмысленное пустое состояние с одним действием, ведущим в GP1/GP3.
Evidence: mobile-web E2E «cold start» для обеих ролей.

**C8 · P1 · Web-демо-стенд.**
`npm run demo:web` собирает mobile-web с `iphone-shell.html`, `EXPO_PUBLIC_DEMO=1`, API на local runtime с seed C1. Один README-раздел «Демо за 3 команды». Не деплой — только воспроизводимая локальная сборка.
Evidence: `expo-web-native-capability-integrity` зелёный; скриншоты обеих ролей в PR.

### Фаза D — End-to-end proof

**D1 · P0 · Все 8 golden paths зелёные (API + mobile-web).** Снять allowed-to-fail с job `golden-paths`.
**D2 · P0 · Negative paths.** Для каждого GP минимум 2 отрицательных сценария из `GOLDEN-PATHS.md`.
**D3 · P1 · Recovery paths.** Симулятор платежей: webhook пришёл дважды, пришёл раньше создания, пришёл с другой суммой, worker упал между outbox и Expense — состояние сходится через reconciliation. То же для чеков и push receipts.
Evidence: `golden-paths` job зелёный на PostgreSQL topology; `PRODUCTION-READINESS.md` §3 обновлён.

### Фаза E — Consolidation

**E1 · P1 · CI matrix.** 51 workflow → `ci.yml` (lint/typecheck/unit), `postgres-integrity.yml` (matrix по текущим integrity-suite), `security.yml`, `mobile.yml`, `golden-paths.yml`, `release.yml`. Старые workflow — в `.github/workflows/archive/` с `if: false` на один релизный цикл, затем удаление по §1.1. Набор проверок не уменьшается: proof — таблица «старый workflow → новый job».
**E2 · P1 · Docs archive.** Всё `docs/AUDIT-*`, `DOCUMENT-CENTER-WAVE*`, `MERGE-*`, `CI-*-FIX-*`, `*-2026-07-*` → `docs/archive/` с `HISTORICAL` шапкой. `README.md` §«Исторические документы» обновлён. `AGENTS.md` — не длиннее текущего; ссылки на архив.
**E3 · P0 · Readiness truth.** `PRODUCTION-READINESS.md` и `production-readiness-evidence.json`: новый раздел `product_completeness` с 8 GP и их статусом; provider matrix отражает режимы `simulated/real`; внешние блокеры (#233–#257) не трогаются и не закрываются.
**E4 · P2 · LICENSE.** Добавить `LICENSE` в корень (владелец выбирает; до выбора — `All rights reserved`).

---

## 5. Definition of Done (дополняет `AGENTS.md` §12)

PR по мандату считается готовым, когда:

1. Задача указана по ID; scope PR не шире задачи.
2. Разделы PR из §1.4 заполнены; `Chain verified` содержит реальный путь, а не шаблон.
3. `Removal proof` присутствует при любом удалении; без него PR возвращается.
4. `test-focused` и `test-full` зелёные локально; число passed ≥ baseline; релевантные PostgreSQL integrity зелёные в CI.
5. Затронутые golden paths прогнаны; если статус GP изменился — обновлена таблица в `GOLDEN-PATHS.md` §«Статус».
6. Найденные вне scope дефекты оформлены как issue со ссылкой на файл/строку.
7. Ни один провайдер не переведён в `real`; `production`/`staging` policy не ослаблена.
8. `typecheck:mobile` зелёный; новые экраны — только через `routeRegistry`.

---

## 6. Порядок работы одного агента над задачей

1. Прочитать `AGENTS.md`, этот документ, `GOLDEN-PATHS.md`, контракт затронутой области в `technical-spec/`.
2. `npm run dev -- doctor && bootstrap && check && test-focused` — зафиксировать baseline в PR.
3. Найти все точки цепочки §1.3 через grep, записать список файлов *до* правок.
4. Написать/расширить тест, который падает.
5. Реализовать минимально; не рефакторить соседнее.
6. Прогнать §5.4; приложить вывод.
7. Пройти цепочку §1.3 руками (curl + mobile-web) и описать.
8. Открыть PR по §1.4. Не мержить самостоятельно — merge делает владелец или второй агент-ревьюер по §7.

---

## 7. Ревью вторым агентом

Каждый PR фазы A–B и каждый PR с удалениями проходит ревью вторым агентом с чек-листом:

- Воспроизвёл `Evidence` независимо? (не доверять выводу из описания)
- `Removal proof`: повторил grep сам, результат совпал?
- Цепочка §1.3 замкнута? Есть ли экран/эндпоинт, который стал недостижим?
- Есть ли расширение legacy writer или новый прямой вызов провайдера в обход порта?
- Что ещё сломается, если это смержить? (назвать минимум одну гипотезу и проверить)

Ревью пишется как комментарий к PR с вердиктом `APPROVE` / `CHANGES_REQUESTED` и списком проверенных пунктов.

---

## 8. Что мандат явно НЕ включает

- Внешний staging, production, managed backup/PITR, observability delivery, pentest, main protection (#233, #234, #235, #236, #237, #247, #256, #257) — остаются открытыми и не закрываются никакими PR по мандату.
- Живые ключи и реальные транзакции.
- Публикация в TestFlight/App Store.
- Юридический контур (оферта, ПДн) — отдельное решение владельца.

---

## 9. Журнал конфликтов и решений

| Дата | Конфликт | Решение | Кто |
|---|---|---|---|
| — | — | — | — |

Агент, обнаруживший противоречие между этим документом, `AGENTS.md` и кодом, добавляет строку сюда в том же PR и не принимает решение самостоятельно, если оно меняет продуктовое поведение.
