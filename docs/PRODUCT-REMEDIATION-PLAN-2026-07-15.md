# Renova — план устранения пробелов (post-audit v0.2)

**Дата:** 2026-07-15  
**Основание:** `docs/MARKET-COMPETITIVE-AUDIT-2026-07-15.md`  
**Цель:** довести продукт до **улучшенного аналога** (RU B2B reno ≈ Vition/Smetter UX + сквозные цепочки Buildertrend-level).

**Принцип:** каждая задача = **действие + state + next owner + side effect** (чат/календарь/документ/событие). Без декоративных экранов.

---

## Фаза P0 — Golden path (4–6 недель)

*Блокирует доверие заказчика и исполнителя. Без P0 нельзя честный TestFlight.*

### P0.1 Единый канон приёмки

| Поле | Значение |
|------|----------|
| **Проблема** | 3 API + 2 mobile UX; разная оплата и акты |
| **Файлы backend** | `work_acceptances.py` (канон), `projects.py` (legacy accept), `os.py` (`/acceptances`) |
| **Файлы mobile** | `WorkAcceptanceScreen.tsx`, `CustomerControlView.tsx`, `HomeAcceptanceBanner.tsx`, `lib/api/workAcceptances.ts`, `lib/api/workOrders.ts` |
| **Действия** | 1) `projects.py` accept → HTTP 410 + header `X-Deprecated-Use: work-acceptances` 2) `os.py` accept → proxy to work_acceptances service 3) Mobile: все list/submit → `workAcceptancesApi` 4) Control tab читает work-acceptances |
| **Side effects** | Сохранить: notify, activity, document act, payment gate (уже в work_acceptances) |
| **Acceptance** | e2e-smoke PASS; новый test `test_legacy_accept_returns_410`; mobile `mobile:test` |
| **Оценка** | 9/10 impact |

### P0.2 Единый канон оплаты

| Поле | Значение |
|------|----------|
| **Проблема** | Finance Center обходит PaymentDetailSheet |
| **Файлы** | `FinanceCenterScreen.tsx`, `PaymentDetailSheet.tsx`, `OsBudgetHubScreen.tsx` |
| **Действия** | Finance Center: список pending → tap открывает sheet; удалить прямой `confirmPayment` 2) `routeRegistry`: finance-center → `opensSheet: payment` или redirect `budget?tab=payments` |
| **Acceptance** | Manual: оплата без приёмки блокируется одинаково в обоих входах |
| **Оценка** | 9/10 |

### P0.3 Cross-domain notify на деньги и CO

| Поле | Значение |
|------|----------|
| **Файлы** | `change_orders.py`, `change_order_service.py`, `payments.py`, `project_document_service.py` |
| **Действия** | create/approve/reject CO → `notify(change_order)` + `activity` 2) payment confirm → notify обеим сторонам 3) document sign/archive → notify customer + activity |
| **Acceptance** | pytest: notification row created; digest endpoint includes CO |
| **Оценка** | 8/10 |

### P0.4 Mobile dead ends batch 1

| ID | Fix | Файл |
|----|-----|------|
| M5 | Hide Kontur if `!providers.kontur.available` | `DocumentsHub.tsx` |
| M6 | Alert → CTA upload | `DocumentsHub.tsx` |
| M10 | `notification_type` → router map | `NotificationsScreen.tsx` + `lib/pushLinks.ts` |
| M7 | Reuse `documentUploadPick` | `DesignPackageList.tsx` |
| M13 | `role="contractor"` | `ContractorControlView.tsx` |

### P0.5 ACL унификация

| Поле | Значение |
|------|----------|
| **Файлы** | `receipts.py`, `export.py`, `analytics.py`, `change_orders.py`, `estimate.py` |
| **Действия** | Replace `get_project` with `require_project` / membership check |
| **Acceptance** | e2e cross-project 404/403 без утечки title |

---

## Фаза P1 — Must-have рынка (6–10 недель)

### P1.1 ЮKassa live (staging)

| Поле | Значение |
|------|----------|
| **Файлы** | `yookassa_service.py`, `payments.py`, mobile payment return deep link |
| **Действия** | Webhook idempotency; mobile `renova://payment-return`; убрать auto-demo Pro в staging |
| **Интеграция** | Budget › Payments › sheet › «Оплатить картой» |
| **Acceptance** | Staging smoke с test keys; e2e mock webhook |

### P1.2 E-sign chain на актах

| Поле | Значение |
|------|----------|
| **Файлы** | `esign/kontur.py`, `documents.py`, `DocumentsHub.tsx` |
| **Действия** | Kontur HTTP minimal; pending → webhook → `signed_at`; mobile polling status |
| **Acceptance** | Sandbox KONTUR_MODE=sandbox e2e |

### P1.3 Schedule SoT

| Поле | Значение |
|------|----------|
| **Файлы** | `project_work_schedule_service.py`, `calendar_service.py`, `os.py` schedule |
| **Действия** | Document: work_schedule = SoT; calendar = view; OS summary reads SoT |
| **Acceptance** | One create path; WorkScheduleScreen status sync label |

### P1.4 Route registry v2

| Поле | Значение |
|------|----------|
| **Файлы** | `routeRegistry.ts`, `OsSectionMenu.tsx`, `legacyRoutes.ts` |
| **Действия** | Добавить stack routes (inbox, stage, scan-receipt, conflicts); promote reports from wip; delete 5 legacy tabs per sprint |
| **Acceptance** | `test:routes` covers all user-facing entries |

### P1.5 Offline parity

| Поле | Значение |
|------|----------|
| **Файлы** | `workAcceptances.ts`, `documents.ts`, `payments.ts` |
| **Действия** | Enqueue accept/return; block upload with clear message OR queue metadata |
| **Acceptance** | `test:offline` new cases |

### P1.6 Automation cron

| Поле | Значение |
|------|----------|
| **Файлы** | `automation_engine.py`, `main.py` lifespan, `notifications.py` |
| **Действия** | Startup tick or APScheduler: reminders, waste, overdue stages |
| **Acceptance** | Integration test fake clock |

### P1.7 Procurement hub (RU parity)

| Поле | Значение |
|------|----------|
| **IA** | Repair › Materials → subtabs: Picks · Purchases · Receipts |
| **Файлы** | `OsMaterialsHub` (new or extend), `purchases.py`, `materials.py`, `receipts.py` |
| **Цепочка** | pick approved → purchase created → receipt scan → plan-fact update |
| **Acceptance** | E2E: pick → purchase → receipt link |

---

## Фаза P2 — UX premium + конкурентное усиление (10–16 недель)

### P2.1 Web client portal (branded)

- Read-only routes: schedule, documents, payments pending, accept/sign
- Share via `viewers` + magic link JWT
- Отдельный `apps/web-portal` или Expo web subset

### P2.2 Selections tracker

- Model: room × category × SKU × allowance × approve
- UI: Repair › Selections (customer approve / contractor propose)

### P2.3 Plan-pinned punch

- `floor-plans` + issue/acceptance photo with x,y
- Fieldwire-like tap on plan

### P2.4 Native file parity

- `downloadFile.ts` → expo-sharing
- `IcalImportButton` → document picker + backend import endpoint

### P2.5 Budget BFF

- `GET /projects/{id}/budget-summary` — single JSON for mobile budget hub

### P2.6 AI progress digest (optional)

- Extend `kpi-weekly.pdf` + push notification summary via Ollama

---

## Фаза P3 — Scale (backlog)

- 1C export / bank CSV import
- Marketplace ↔ project convert (job-lead → project)
- Warranty tickets post-closeout
- Delete `api/ws.py` dead code
- `poetry.lock` full (alembic without pip sidecar)

---

## Матрица приоритет × усилие

| Задача | Impact | Effort | Sprint |
|--------|--------|--------|--------|
| P0.1 Acceptance unify | 10 | M | 1 |
| P0.2 Finance sheet | 9 | S | 1 |
| P0.3 Notify CO/pay/doc | 8 | M | 2 |
| P0.4 Dead ends batch | 7 | S | 2 |
| P0.5 ACL | 8 | M | 2 |
| P1.1 ЮKassa | 9 | L | 3–4 |
| P1.2 E-sign live | 8 | L | 4–5 |
| P1.3 Schedule SoT | 7 | M | 3 |
| P1.4 Registry v2 | 6 | M | 3–4 |
| P1.5 Offline | 7 | M | 4 |
| P1.6 Cron | 6 | S | 4 |
| P1.7 Procurement hub | 8 | L | 5–6 |

---

## Definition of Done (улучшенный аналог)

1. Заказчик проходит **без тупиков**: приёмка → акт в документах → оплата (gate) → уведомление исполнителю.
2. Исполнитель: этап готов → приёмка → CO (если есть) → закупка → чек → plan-fact.
3. **Один** API приёмки, **один** вход оплат, **один** список документов.
4. Staging: Postgres + ЮKassa test + Kontur sandbox.
5. TestFlight чеклист из `TESTFLIGHT-NOTES-v0.2.md` — все пункты PASS.
6. Конкурентная матрица: нет красных 🔴 в строках P0 таблицы аудита.

---

## Трекинг в git

После каждой фазы обновлять:

- `docs/PRIORITY-EXECUTION-PLAN.md` — статус волны
- `docs/MARKET-COMPETITIVE-AUDIT-2026-07-15.md` — колонка «После fix»
- `docs/ARCHITECTURE-AUDIT-RU.md` — закрытие A-xx пунктов

**Волна P0 старт:** следующий коммит после этого документа — задача P0.1 (acceptance unify).
