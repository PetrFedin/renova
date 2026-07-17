# Renova — рыночный аудит и внутренний gap-анализ

> **Post-P2.5 update →** [`RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md`](RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md) — синтез конкурентов, UI/UX, тупиков и P3/P4 roadmap.


**Дата:** 2026-07-15  
**Репозиторий:** https://github.com/PetrFedin/renova  
**Ветка анализа:** `develop` (после v0.2.0 на `main`)  
**Метод:** 3 параллельных code-агента (backend, mobile UX, конкуренты) + web-поиск RU-аналогов + grep по stubs/dead ends.

**Связанный план работ:** `docs/PRODUCT-REMEDIATION-PLAN-2026-07-15.md`

---

## 0. Резюме для решений (1 страница)

| Измерение | Оценка | Комментарий |
|-----------|--------|-------------|
| **Архитектура backend** | ~75% | 268 endpoints, золотой путь есть, но 3 пути приёмки и рыхлый ACL |
| **Mobile product completeness** | ~65% | 84 route-файла vs 17 в registry; много stack-экранов «вне карты» |
| **Паритет с RU-аналогами (Smetter/Vition/ПРОРАБ)** | ~70% | Смета, этапы, акты, чат — да; закупки/1С/ЛК-web — слабо |
| **Паритет с global remodel PM (Buildertrend/Houzz)** | ~55% | Нет selections, branded portal, online pay, CO+eSign chain |
| **Field/приёмка (Fieldwire-уровень)** | ~50% | Приёмка есть, но без pin на план/комнату и единого punch UX |
| **UX / IA зрелость** | ~60% | 4 столпа + «Ещё» + legacy tabs = когнитивная перегрузка |
| **Offline** | ~40% | Очередь только на ~10 мутаций; документы/приёмка screen — online |
| **Интеграции (платежи, eSign, OCR)** | ~25% live | Большинство env-stub; in_app sign + heuristic OCR работают |

**Главный стратегический вывод:** Renova уже **в полосе RU renovation B2B** по ядру (объект → этап → приёмка → оплата → документ), но **проигрывает зрелости** из‑за внутренних дублей API/экранов и отсутствия «сквозных цепочек» (CO→бюджет→уведомление, оплата→эквайринг, документ→eSign live).

**Топ-5 блокеров до «улучшенного аналога»:**

1. **Один канон приёмки** — `work-acceptances` vs `/acceptances` (OS) vs legacy `stages/accept`.
2. **Один канон финансов** — Finance Center обходит `PaymentDetailSheet` и gate по приёмке.
3. **Сквозные side-effects** — change orders, payment confirm, documents без notify/activity/chat.
4. **Native parity** — PDF/ICS/upload stubs на iOS там, где DocumentsHub уже умеет picker.
5. **Must-have рынка** — online acquiring (ЮKassa live), legal eSign на актах, procurement loop.

---

## 1. Позиционирование на рынке

Renova = **dual-role B2B платформа ремонта квартир/домов**:

- **Заказчик:** контроль этапов, приёмка, бюджет, документы, чат.
- **Исполнитель:** график, смета, закупки, отчёты, бригада.

**Ближайшие аналоги по ДНК продукта:**

| Кластер | Примеры | Пересечение с Renova |
|---------|---------|----------------------|
| RU ERP/объект | Smetter, RemontCRM, Петрович.BRO, строй.онлайн | Смета→этапы→финансы→акты |
| RU заказчик-центричные | Рембот, Stadia, Vition, ПРОРАБ.контроль | Этапы, чек-листы, приёмка, фото |
| Global remodel PM | Buildertrend, JobTread, Houzz Pro | Client portal, CO, draws, selections |
| Field / QA | Fieldwire, PlanRadar, «Приёмка Про» | Punch, фото на плане, offline |
| Enterprise (не цель) | Procore | RFIs, BIM — избыточно для квартиры |

Renova **не должен** копировать Procore. Целевой «улучшенный аналог» = **Smetter/Vition + Buildertrend client experience + Fieldwire приёмка на объекте**.

---

## 2. Матрица паритета функций

Легенда: ✅ есть и рабочее · 🟡 частично/stub · ❌ нет · 🔴 дубль/конфликт

| Область | Стандарт рынка 2025–26 | Renova | Gap / риск |
|---------|------------------------|--------|--------------|
| Dual roles customer/contractor | ✅ | ✅ | Low |
| Project hub / OS 4 столпа | ✅ | ✅ | Low |
| Комнаты + смета (calc-engine) | ✅ | ✅ | Low |
| Этапы + график | ✅ | 🟡 | **3 модели schedule** (work-schedule, calendar, OS summary) |
| **Приёмка этапа** | ✅ | 🔴 | **3 API-пути**, 2 mobile-экрана |
| Change orders | ✅ | 🟡 | Данные есть; **нет notify/activity**; нет eSign chain |
| Платежи по этапам | ✅ | 🟡 | Confirm flow есть; **нет live acquiring** |
| Budget plan-fact | ✅ | ✅ | Medium vs customer transparency (Buildertrend views) |
| Закупки / материалы | ✅ RU | 🟡 | purchases/material-picks; **нет retailer cart** |
| Document center | ✅ | ✅ | Strong; OCR/eSign external = stub |
| Чат по проекту | ✅ | ✅ | Low |
| Календарь / сроки | ✅ | 🟡 | **3 входа** (calendar tab, home, work-schedule) |
| Уведомления + inbox | ✅ | 🟡 | Тап без link_path → **dead end** |
| ФНС / чеки QR | ✅ RU | 🟡 | receipts + verify stub |
| Offline поле | ✅ Fieldwire | 🟡 | ~10 мутаций в очереди |
| Selections (чистовая) | ✅ Houzz/BT | ❌ | **High** для premium сегмента |
| Branded web ЛК заказчика | ✅ | ❌ | **High** — mobile-first |
| Online pay (карта/SBP live) | ✅ | ❌ | **High** — ЮKassa stub |
| Legal eSign (Контур/Госключ) | ✅ RU | 🟡 | Scaffold; default 501 |
| 1C / банк / CRM API | ✅ RU scale | ❌ | Medium–High |
| AI digest прогресса | Emerging | ❌ | Medium (2026 ожидание) |
| Тендер / marketplace | RU строй.онлайн | 🟡 | job-leads отдельно от project chat |
| Warranty post-closeout | BT heritage | ❌ | Low MVP |

---

## 3. Что у нас **сильнее** или на уровне аналогов

1. **Document Center 0.2** — версии, ACL, legal hold, OCR flags, mobile upload (лучше многих RU «чат+фото» решений).
2. **Environment profiles** — staging/prod guards (редкость у MVP конкурентов).
3. **Golden path e2e** — accept → payment gate → act in documents (прозрачная цепочка).
4. **ФНС/чеки** в roadmap уже в коде — дифференциатор vs global PM.
5. **Offline queue** на критичных полевых действиях (comments, photos, stage accept via stages API).
6. **4-столпная IA** — ближе к RU «карточка объекта», чем к Procore tool-silo.

---

## 4. Чего **нет**, но есть обязательно у конкурентов

### P0 — без этого продукт «не дотягивает» до Vition/ПРОРАБ

| # | Функция | У кого | Куда интегрировать в Renova |
|---|---------|--------|------------------------------|
| 1 | **Единая приёмка** (один API, один UX) | Vition, ПРОРАБ, Fieldwire | Backend: deprecate `os/acceptances` + legacy `stages/accept`. Mobile: все CTA → `/work-acceptance` |
| 2 | **Оплата с gate по приёмке** везде | Все PM | `FinanceCenterScreen` → reuse `PaymentDetailSheet` |
| 3 | **Уведомление при CO / оплате / документе** | Smetter, BT | `change_orders.py`, `payments.py`, `documents.py` → `notification_service` + `activity_service` |
| 4 | **Live ЮKassa** (хотя бы staging) | RU стандарт | `yookassa_service.py` + mobile deep link return |
| 5 | **Акт PDF + in_app sign без тупиков** | Smetter, ПРОРАБ | Уже есть; убрать Kontur CTA когда `available=false` |

### P1 — «улучшенный аналог»

| # | Функция | Интеграция |
|---|---------|------------|
| 6 | Procurement loop (заявка→закупка→чек→plan-fact) | Связать `material-picks`, `purchases`, `receipts` в один hub tab «Снабжение» |
| 7 | Selections tracker | Новый pillar subsection в Repair или Budget; модель `selection_items` |
| 8 | Branded web client portal | `apps/web-client` или `/platform` read-only; share link из `viewers` |
| 9 | Pin defect на план/комнату | `floor-plans` + issues/acceptance photo coords |
| 10 | Cron reminders | Wire `automation_engine.scan_project_reminders` |

### P2 — масштаб и retention

| # | Функция |
|---|---------|
| 11 | 1C export / bank statement import |
| 12 | AI weekly digest (уже есть kpi-weekly.pdf — добавить LLM summary) |
| 13 | Warranty / post-closeout tickets |

---

## 5. Что **лишнее** или **задвоено** (внутри Renova)

### 5.1 Backend — параллельные реализации

| Дубль | Пути | Риск | Рекомендация |
|-------|------|------|--------------|
| Приёмка этапа | `work-acceptances` · `projects/.../accept` · `os/acceptances` | Разная оплата/документы | **Оставить только work-acceptances** |
| График | `project_work_schedule` · `calendar` · `os/schedule` | 3 SoT | `project_work_schedules` = SoT; остальное derived |
| Budget read | `analytics/*` · `os/budget` · dashboard | Путаница цифр | Один BFF endpoint `/projects/{id}/budget-summary` |
| WebSocket | `api/ws.py` (dead) · `api/v1/ws.py` | Drift | Удалить мёртвый файл |
| ACL | `require_project` vs `get_project` only | Утечка IDOR | Унифицировать на `require_project` |

### 5.2 Mobile — параллельные входы

| Зона | Дубли | Рекомендация |
|------|-------|--------------|
| Финансы | Dock «Бюджет» · `/finance-center` · legacy `finance`/`money` tabs | Один hub: Budget › Payments; finance-center = redirect |
| Приёмка | Repair control tab (`/acceptances`) · `/work-acceptance` · Home banner → repair | Один экран + один API |
| Документы | Home more · OsSectionMenu · profile · estimate layer | Один пункт «Документы» + badge |
| Календарь | Tab calendar · Home CTA · `/work-schedule` | Hub «Сроки»: calendar + link to schedule |
| Качество | `/quality-control` · repair control · stage detail issues | QC = issues only; cross-link |

### 5.3 Legacy technical debt

- **15+ hidden tabs** с `LegacyTabRedirect` (`plan`, `works`, `control`, `money`…) — держать до stable registry, затем удалить файлы.
- **routeRegistry** описывает 17 маршрутов при **84** route files — registry не отражает продукт.

### 5.4 Vs конкуренты — что можно **не** тащить

| У нас есть | У конкурентов редко / не нужно MVP | Действие |
|------------|-----------------------------------|----------|
| Marketplace job-leads | Отдельный от project CRM | Оставить, но не смешивать с project chat |
| Admin/articles | Content marketing | Вынести из core IA (скрытый route OK) |
| Subscription Pro stub | Monetization early | OK для dev; не показывать в prod без billing |
| Множество PDF export endpoints | OK | Объединить в DocumentsHub meta (уже частично) |

---

## 6. UI / IA — сравнение с конкурентами

### 6.1 Паттерн конкурентов (эталон)

**RU (Smetter/Vition):** Объект → Смета (центр) → Этапы → Финансы → Документы/Акты → Фото.

**Global remodel:** Project workspace → Overview (next action) → Schedule → Financials → Files → Messages.

**Field-first:** Plans → tap location → photo/task → sign-off.

### 6.2 Текущая IA Renova

```
Dock: Главная | Объект | Ремонт | Бюджет
Menu: + Чат, Календарь
Util: Inbox, Activity, Documents
«Ещё»: manager-dashboard, finance-center, QC, work-acceptance, work-schedule, documents (×2)
```

### 6.3 Рекомендуемая целевая IA (без смены URL)

| Столп | Содержимое | Убрать/слить |
|-------|------------|--------------|
| **Главная** | Next action banner (приёмка/оплата/CO), KPI, inbox preview | Дубли CTA в «Ещё» |
| **Объект** | Комнаты, план, viewers, setup checklist | — |
| **Ремонт** | Works · Materials · **Приёмка (canonical)** · QC link | Control tab → work-acceptance |
| **Деньги** | Summary · Expenses · **Payments (sheet flow)** · Deviations | finance-center → tab deep link |
| **Ещё (свернуть)** | Документы · График · Уведомления · Manager | documents ×1 entry |

### 6.4 Оформление / расположение информации

| Проблема | Сейчас | Как у аналогов | Оптимизация |
|----------|--------|----------------|-------------|
| Next action | Размазано по banner, inbox, notifications | Один «что сделать сейчас» на Overview | `buildHomeKpiDetail` + единая очередь действий |
| Платёж | Alert-цепочки, Finance без sheet | Invoice drawer + pay CTA | Всегда `PaymentDetailSheet` |
| Документ без файла | Alert с meta, без CTA | «Добавить файл» | Upload CTA в alert |
| Уведомление без link | mark read only | Deep link по type | Fallback router по `notification_type` |
| Приёмка | Hardcoded checklist 10/5 | Editable checklist modal | Форма перед submit |
| Ошибки API | Много generic Alert | Toast + retry + offline badge | `offlineUi.ts` везде |

---

## 7. Реестр тупиков и разорванных связей

### 7.1 Mobile — dead ends (кнопка не ведёт к результату)

| ID | Экран | Проблема | Файл |
|----|-------|----------|------|
| M1 | Finance Center | Confirm без sheet / без acceptance gate | `FinanceCenterScreen.tsx` |
| M2 | Home banner | → repair control, не work-acceptance | `HomeAcceptanceBanner.tsx` |
| M3 | Repair Control | API `/acceptances` ≠ canonical | `CustomerControlView.tsx` |
| M4 | Work Acceptance | Ошибки без UI; нет offline_queued | `WorkAcceptanceScreen.tsx` |
| M5 | DocumentsHub | Kontur CTA → alert 501 | `DocumentsHub.tsx` |
| M6 | DocumentsHub | Doc без файла — alert без upload | `DocumentsHub.tsx` |
| M7 | DesignPackage | PDF upload «только web» | `DesignPackageList.tsx` |
| M8 | downloadFile / PDF | Native → «откройте в браузере» | `lib/downloadFile.ts` |
| M9 | IcalImport | «только web» | `IcalImportButton.tsx` |
| M10 | Notifications | Нет navigation без link_path | `NotificationsScreen.tsx` |
| M11 | PaymentDetailSheet | SBP — alert text only | `PaymentDetailSheet.tsx` |
| M12 | Project Analytics | WIP route = redirect | `app/project-analytics.tsx` |
| M13 | Contractor control | role default customer в empty state | `UnifiedAcceptanceList.tsx` |

### 7.2 Backend — разорванные cross-domain связи

| ID | Действие | Нет связи | Файл |
|----|----------|-----------|------|
| B1 | Legacy stage accept | Document Center, payment gate | `projects.py` |
| B2 | OS acceptances accept | То же | `os.py` |
| B3 | Change order CRUD | notify `change_order` | `change_orders.py` |
| B4 | Payment confirm | notify контрагенту | `payments.py` |
| B5 | Document upload/sign | activity/notify | `documents.py` |
| B6 | Stage start | calendar event write | `stage_service.py` |
| B7 | `scan_project_reminders` | не вызывается | `automation_engine.py` |
| B8 | Waste reminders | только manual POST | `notifications.py` |

### 7.3 Demo / stub (выглядит рабочим — не prod)

| Компонент | Поведение | Env |
|-----------|-----------|-----|
| Demo auth phones | Автовход | development seed |
| ЮKassa / Pro | instant demo | no keys |
| SMS/OTP | demo_code | no Twilio |
| OCR | keyword heuristic | always |
| Kontur/Goskey | 501 / sandbox | KONTUR_MODE off |
| FNS receipt verify | stub | — |
| Price parser materials | stub | — |
| Email budget alert | log only | — |
| EXPO_PUBLIC_DEMO=1 | Demo recovery UI | `.env.example` |

---

## 8. Offline — coverage gap

**В очереди:** stage comments/photos, work-acceptances (via stages.ts), room patch, receipts, payment confirm, chat messages.

**Не в очереди (полевой риск):** workAcceptances.ts direct, documents upload/sign, payment create, issues, schedule CRUD, scratchpad, design upload.

---

## 9. E2E / тестовое покрытие vs продукт

`e2e-smoke.sh` покрывает: auth, acceptance, payments, documents, OCR, media ACL, viewers.

**Не покрыто:** marketplace, teams, change-orders, OS acceptances regression, legacy accept path, work-schedules, subscription webhook.

---

## 10. Итоговая шкала «до улучшенного аналога»

| Milestone | Критерий готовности | Сейчас |
|-----------|---------------------|--------|
| **M1 Consistent core** | 1 acceptance API, 1 finance flow, registry=screens | ~40% |
| **M2 Trustworthy ops** | Live pay staging, eSign in_app+PDF, notify on all money events | ~55% |
| **M3 RU parity** | Procurement loop, ФНС live verify, акты в ЛК | ~65% |
| **M4 Premium remodel** | Selections, plan-pinned punch, web portal | ~45% |
| **M5 Scale** | 1C, cron automation, AI digest | ~30% |

**Целевой «улучшенный аналог» для 2026:** M1+M2+M3 (≈ **80% perceived completeness** для RU B2B reno).

---

## 11. Источники анализа

- Backend agent: 268 endpoints, P0 acceptance triple, ACL gaps
- Mobile agent: 84 routes, 13 dead ends, offline matrix
- Market agent: Buildertrend, Houzz, Fieldwire, Smetter, RemontCRM, BRO
- Web: Рембот, Stadia, ПРОРАБ.контроль, Vition
- Repo: `ARCHITECTURE-AUDIT-RU.md`, `routeRegistry.ts`, `e2e-smoke.sh`

**Следующий шаг:** выполнение `PRODUCT-REMEDIATION-PLAN-2026-07-15.md` фазами P0→P2.
