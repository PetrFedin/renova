# Renova — публичная страница платформы / investor product brief

**Status:** governed presentation contract  
**Route:** `/platform`  
**Issue:** #373  
**Audience:** потенциальный заказчик, исполнитель, партнёр, инвестор, руководитель, технический специалист.  

## 1. Назначение

`/platform` — публичная mobile-first одностраничная презентация Renova. Она не заменяет приложение и не создаёт отдельную demo-бизнес-логику. Её задача — дать человеку, перешедшему по QR или прямой ссылке, проверяемое понимание:

1. что представляет собой Renova;
2. какой сквозной lifecycle ремонта моделирует продукт;
3. какие роли и домены связаны внутри;
4. как устроена production-oriented архитектура;
5. какая часть продукта подтверждена исходным кодом;
6. что ещё находится в hardening / acceptance;
7. какие внешние результаты нельзя считать проверенными без retained evidence;
8. куда перейти для входа в продукт, технического источника или контакта.

Страница следует текущему коду, `AGENTS.md`, living specification, `PRODUCTION-READINESS.md` и полному product audit. Старые demo/MVP/audit snapshots не используются как актуальная продуктовая правда.

## 2. Claims boundary

На странице запрещено без отдельного проверяемого источника публиковать:

- TAM/SAM/SOM и оценку рынка;
- выручку, valuation, fundraising round, клиентскую базу;
- ROI, проценты экономии, ускорение сроков, снижение ошибок;
- production-ready / externally verified / live-provider claims;
- App Store/TestFlight/managed-restore/security/capacity claims без retained evidence конкретного release candidate;
- функции roadmap как уже доступные пользователю.

Если факт подтверждён только source inspection, он описывается как `подтверждено в source`, а не как production verification.

Текущий broad-production verdict на момент этого контракта: `BLOCKED_FOR_BROAD_PRODUCTION`.

## 3. Структура страницы и готовый copy

### 3.1. Header

**Brand:** `RENOVA`  
**Subline:** `PLATFORM BRIEF`  
**Status:** `ПУБЛИЧНЫЙ ОБЗОР`.

Header должен быть компактным и не конкурировать с hero.

### 3.2. Hero

**Eyebrow:** `ОПЕРАЦИОННАЯ СИСТЕМА РЕМОНТА`

**H1:**  
`Renova объединяет ремонт в один управляемый процесс`

**Lead:**  
`От объекта и сметы до работ, материалов, приёмки, денег, документов и гарантии — в одной связанной системе для заказчика, исполнителя и контроля.`

**Primary CTA:** `Открыть платформу` → `/onboarding/role`.

**Optional secondary CTA:** `Партнёрство / инвестиции` → `EXPO_PUBLIC_PLATFORM_CONTACT_URL`. Если переменная не задана или URL невалиден, CTA не отображается.

Hero visual — абстрактный control cockpit из реальных понятий продукта, а не выдуманный dashboard с фиктивными KPI:

- Объём → `СМЕТА + CHANGE`;
- Исполнение → `ЭТАПЫ + РАБОТЫ`;
- Материалы → `ПОТРЕБНОСТЬ → ЗАКУПКА`;
- Контроль → `ПРИЁМКА + ДОКАЗАТЕЛЬСТВА`;
- Финансы → `РАСХОД ≠ ПЛАТЁЖ`.

### 3.3. Problem framing

**Eyebrow:** `ПРОБЛЕМА, КОТОРУЮ РЕШАЕТ ПРОДУКТ`

**Title:** `Одна картина вместо фрагментов`

**Lead:**  
`Renova проектируется вокруг результата ремонта: не отдельного чата, сметы или календаря, а их согласованной связи.`

Карточки:

1. `Один объект` — данные проекта не должны жить в несвязанных таблицах, переписках и файлах.
2. `Один контекст` — решение, работа, документ, расход и доказательство сохраняют связь с причиной и объектом.
3. `Явные права` — роль сама по себе не даёт доступ ко всему проекту; важен project/resource scope.
4. `Восстановление` — повтор, сбой сети или провайдера рассматриваются как нормальные сценарии системы.

Это продуктовая постановка, а не количественная оценка рынка.

### 3.4. End-to-end lifecycle

**Eyebrow:** `END-TO-END`

**Title:** `Сквозной процесс`

Последовательность:

1. **Объект и помещения** — единый проект, параметры, комнаты и исходный контекст.
2. **Смета и изменения** — planned scope/cost и Change Order не смешиваются с фактическими расходами.
3. **Сроки и работы** — Stage, Work Order, schedule и dependencies.
4. **Материалы и закупки** — потребность → выбор → Purchase/Purchase Item → поставка/подтверждение.
5. **Коммуникация и контроль** — чат, комментарии, фото, approvals, technical supervision.
6. **Приёмка и доработки** — выполнение, acceptance, issue/rework не являются одним статусом.
7. **Деньги и документы** — Estimate/Commitment/Expense/Payment/Receipt/evidence сохраняют отдельную семантику.
8. **Завершение и гарантия** — acceptance lineage, warranty, archive/trash/retention.

Визуально это одна связанная цепь, но UI не должен создавать ложного впечатления, что переход между всеми этапами уже полностью production-qualified.

### 3.5. Product core

**Title:** `Что внутри платформы`

Шесть блоков:

- единая модель объекта;
- исполнение;
- закупки;
- финансовая правда;
- документы и взаимодействие;
- надёжность операций.

Текст должен подчёркивать доменные связи и source of truth, а не количество экранов.

### 3.6. Roles

**Title:** `Один проект — разные рабочие контуры`

Показываются:

- Заказчик;
- Исполнитель;
- Технический надзор;
- Команда и участники.

Обязательная оговорка для participant/multi-contractor: foundation и management существуют, но полный scoped multi-contractor domain/mobile/payee/document/chat journey остаётся незавершённым согласно readiness.

### 3.7. Product / investment thesis

**Title:** `Почему это может становиться платформой, а не ещё одним приложением`

Четыре архитектурные тезиса:

1. связанный граф ремонта;
2. повторяемый lifecycle проекта;
3. provider-independent core;
4. основа для аналитики после квалификации качества данных.

На странице явно указано: это продуктовая инвестиционная логика архитектуры, не market sizing, valuation, финансовый forecast или обещание ROI.

### 3.8. Architecture

**Title:** `Доменная правда отделена от внешних провайдеров`

Слои:

1. `Mobile / Web` — Expo + React Native + expo-router;
2. `API / Auth / ACL` — FastAPI и scope;
3. `Authoritative state` — PostgreSQL;
4. `Reliability` — Redis + transaction + audit + Domain Outbox;
5. `Execution` — dedicated worker + retry/reconciliation/recovery;
6. `Files` — S3-compatible private object storage;
7. `External systems` — документированные provider/partner boundaries.

Каноническая цепочка:

`Mobile → API/Auth/ACL → PostgreSQL → atomic transaction → audit + Domain Outbox → worker → external provider → reconciliation/health/recovery`.

### 3.9. Status / evidence

**Title:** `Статус продукта — без маркетингового тумана`

Три колонки:

#### Подтверждено в source

Текущий product audit подтверждает существенное реализованное ядро:

- объект и помещения;
- смета и этапы;
- закупки и расходы;
- платежи и документы;
- чат и согласования;
- технический надзор.

Это не автоматически означает full E2E acceptance каждого сценария.

#### Доводится

Минимальный публичный список source-confirmed hardening boundaries:

- session/account fencing;
- idempotency и offline replay;
- cache/transport provenance;
- финансовая аналитика и проекции;
- purge/retention;
- native file delivery;
- полный multi-contractor journey.

#### Требует external evidence

Не объявляются внешне проверенными:

- persistent staging / production;
- live providers;
- managed backup/PITR/restore;
- реальная capacity;
- store/TestFlight delivery;
- независимая security/penetration verification;
- legal/pilot/support operations.

На карточке должен быть показан текущий `BLOCKED_FOR_BROAD_PRODUCTION` verdict до изменения authoritative readiness source.

### 3.10. QR / Share

**Title:** `Один адрес для встреч, презентаций и материалов`

QR генерируется локально существующим `QrCodeImage`, без внешнего QR API.

Canonical URL resolution:

1. если задан `EXPO_PUBLIC_PLATFORM_URL`, используется он;
2. из canonical URL удаляются query и hash;
3. если переменная не задана, web fallback = current origin + `/platform`;
4. invalid protocol/config не должен приводить к crash;
5. UTM не кодируются в постоянный QR.

Это позволяет позже заменить hosting и сохранить QR, если `EXPO_PUBLIC_PLATFORM_URL` закреплён на постоянном branded domain.

### 3.11. Footer

Обязательная оговорка:

`Функциональный статус отражает текущий репозиторий и living specification; страница не является заявлением о production readiness, подтверждённом ROI, размере рынка или финансовом прогнозе.`

## 4. Visual contract

Страница продолжает Renova design system:

- фон / surface / text / accent только из `RenovaTheme` / `uiTokens`;
- slate/blue, спокойный B2B SaaS визуальный язык;
- без локальных hex в `platform.tsx`;
- без emoji как UI icon — только `Ionicons`;
- base radius/spacing из текущих токенов;
- максимальная ширина desktop content около 1180 px;
- mobile-first: на узком экране все сетки переходят в одну колонку;
- типографика крупнее обычного операционного экрана допустима для публичного hero, но функциональная палитра остаётся общей с продуктом;
- реальные screenshots могут быть добавлены только из текущей версии продукта и только после проверки, что они не демонстрируют несуществующее состояние;
- нельзя использовать сторонние логотипы, customer logos или количественные performance claims без проверяемого права/источника.

## 5. CTA contract

| CTA | Destination | Condition |
|---|---|---|
| Открыть платформу | `/onboarding/role` | всегда |
| Партнёрство / инвестиции | `EXPO_PUBLIC_PLATFORM_CONTACT_URL` | только при валидном URL |
| Технический репозиторий | `https://github.com/PetrFedin/renova` | всегда |
| Открыть спецификацию | canonical living spec in GitHub | всегда |

`/platform` не должен автоматически логинить demo user или обходить обычный auth/role lifecycle приложения.

## 6. Environment contract

Новые public build-time variables:

```text
EXPO_PUBLIC_PLATFORM_URL=
EXPO_PUBLIC_PLATFORM_CONTACT_URL=
```

`EXPO_PUBLIC_PLATFORM_URL` должен стать стабильным branded URL до массовой печати QR. Render `*.onrender.com` может использоваться как технический fallback, но не должен называться «вечным» адресом, если домен ещё не закреплён.

## 7. Analytics boundary

В первой реализации страница не добавляет скрытый tracking SDK и не отправляет UTM/PII в Renova backend. Если web analytics будет добавлена позже, это отдельная задача с privacy/cookie/retention решением и явной схемой событий.

## 8. Acceptance

1. `/platform` доступен прямым web URL без auth redirect.
2. Hero и все основные блоки читаются на mobile и desktop.
3. Primary CTA ведёт в канонический `/onboarding/role`.
4. QR появляется после resolve canonical origin/config и содержит `/platform`.
5. Query/hash не попадают в canonical QR.
6. Page copy не противоречит текущему readiness.
7. Web Playwright contract проверяет прямой route, headline, core sections, readiness disclaimer и QR.
8. Никакой новый demo backend, provider activation или отдельный source of truth не создаётся.
9. Публичный route не изменяет product readiness status.
