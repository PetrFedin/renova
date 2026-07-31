# Renova — полный аудит проекта (2026-07-31)

**Срез:** 31.07.2026  
**Ветка аудита:** `feature/renova-product-excellence-pass` @ `4f9d73df` (−195 / +14 vs `origin/main`)  
**Среда:** API `0.3.7` development · Expo web iPhone preview  
**Метод:** 5 параллельных агентов (mobile UX/IA, backend domain, money/portal/approvals, product/tests/CI, nav/lifecycle) + верификация P0 в коде.

**Связанные доки:** `DEAD-ENDS-INVENTORY-2026-07-15.md`, `INVESTOR-CLIENT-IMPROVEMENT-PLAN-2026-07-19.md`, `AUDIT-OPS-REMAINING-2026-07-21.md`, `AUDIT-CLOSURE-MATRIX-2026-07-21.md`, `PRODUCT-AUDIT-SYNTHESIS-2026-07-19.md`.

**Рабочий чеклист волны:** `FULL-PROJECT-AUDIT-WAVE-X-CHECKLIST.md`.

---

## Вердикт (одноабзацно)

Renova — зрелая операционная оболочка ремонта (**смета → lock → график → приёмка → gate оплаты → документы → portal**), но продавать «как SaaS к пилоту завтра» нельзя: staging URL = placeholder, YuKassa не live, pay-only portal-токен может согласовать ДО (дыра в scope), CTA «К оплате» ведёт в Приёмку, WO «оплачено» не переводит статус, destructive кнопки выглядят как primary. Для инвестора это мощный prototype с честными demo-бейджами — не готовый cashflow-продукт.

| Метрика | Балл |
|---------|------|
| Работоспособность продукта (код) | **6.4 / 10** |
| Качество ядра / IA / Clarity A–W | **8.2 / 10** |
| Demo → live trust | **3.4 / 10** |
| Удобство заказчика без няньки | **5.2 / 10** |

| Сигнал | Значение |
|--------|----------|
| Clarity waves A–W | 24 файла (`w153`–`w176`) |
| Отставание от `origin/main` | ~195 коммитов |
| TS errors (baseline) | ~117 (`scripts/typecheck-mobile.sh`) |
| `mobile:test` / Clarity в CI | **нет** |

---

## 1. Что хорошо (moat — не ломать)

| Сила | Доказательство | Почему дорого |
|------|----------------|---------------|
| Канон пути объекта | estimate lock → schedule → `accept_orchestrator` → pay gate → docs | Редкая бизнес-логика vs «чат+Excel» |
| Dual-role IA + `routeRegistry` | dock Home/Object/Repair/Budget/Chat; legacy redirects | Один продукт, не два приложения |
| ActionConfirm + Clarity A–W | 24 теста; sheet вместо Alert на критичных путях | Calm OS / investor DD UX-дисциплина |
| Денежная честность | `paid_unverified`; `needs_acceptance` 409; `IntegrationHonestyBadge` | Перевод ≠ факт бюджета |
| Portal write v2 (частично) | accept / schedule / estimate lock / pay sheet / CO UI | Заказчик без TestFlight |
| Environment guards | staging режет SQLite / default secrets / `X-User-Id` | База для H0 |
| Calc / смета / CO | `packages/calc-engine` + change orders + approvals | Технический дифференциатор |
| Documents hub honesty | OCR/Kontur/подпись mode chips; closeout blockers | B2B без fake «live» |
| Chat unread SoT | `inboxSyncStore` (системный desync закрыт) | Один бейдж |

---

## 2. P0 — чинить до любого investor / pilot демо

| # | Проблема | Где | Эффект |
|---|----------|-----|--------|
| 1 | EAS/staging API = `api-staging.example.com` | `apps/mobile/eas.json` | TestFlight бьёт в пустоту |
| 2 | YuKassa не live / demo checkout | `yookassa_service` + subscription | «Оплата картой» = фейк или 503 |
| 3 | Portal CO без scope `accept_stage` | `backend/app/api/v1/portal.py` approve/reject CO | Pay-only ссылка меняет смету/бюджет |
| 4 | «К оплате» → `repair/control` | `StageContextSummary.tsx` | Разрыв narrative денег |
| 5 | WO «Оплачено» → push budget **без** `transition('paid')` | `WorkOrderDetailScreen.tsx` | Статус работы врёт после CTA |
| 6 | Destructive confirm = primary fill | `ActionConfirmSheet.tsx` | «Отклонить» выглядит как «Да» |
| 7 | Portal sign без pre-confirm | `apps/mobile/app/portal.tsx` | Юр. действие one-tap |
| 8 | Ветка −195 от `main` | git | Integrity-фиксы денег не на этой ветке |
| 9 | Demo YuKassa → `status=succeeded`, webhook без amount → mismatch, платёж не confirm | `payments.py` + `yookassa_service` | Ложный «успех» оплаты |
| 10 | `ALLOW_DEMO_SEED` не hard-fail на staging/prod | `main.py` / `environment.py` | Demo login на «боевом» профиле |
| 11 | Webhook money-fail → HTTP 200 `{ok:true, handled:false}` | `yookassa_service.process_webhook` | Ops думают, что всё ок |

**Ops H0 (не только код):** staging HTTPS, Postgres, Pro accounts, `h0:check:strict` / `:live` PASS, Kontur live smoke.

---

## 3. P1 — тупики, silent fail, разрывы связей

| Зона | Симптом | Файлы |
|------|---------|-------|
| Комнаты | Load fail → silent empty; room detail без этапов/материалов/сроков | `OsRoomsScreen`, `RoomDetailScreen` |
| Этап | Links без materials/payments/approvals/docs; review hint без CTA к приёмке | `StageDetailLinks`, `StageDetailPaymentBlock` |
| Материалы | `advancePurchase` `.catch` noop | `OsMaterialsScreen`, `material/[id]` |
| Approvals | Network/403 fail без UI; нет обратной ссылки со stage/room | `approvals.tsx` |
| Оплаты UX | CTA-стена в `PaymentDetailSheet`; нет sticky footer; double entry «Оплатить» | `PaymentDetailSheet`, `BudgetSummarySection` |
| Деньги API | Нет cancel/refund/dispute API при живых enum | `payment_service`, mobile `payments.ts` |
| Waste / Purchase | Нет transition matrix; `complete` / `set_status` без SM | `waste_orders.py`, `purchase_service` |
| Outbox | unknown/missing → `processed_at` без side-effects | `outbox_service.py` |
| Календарь | Вне default dock | `dockBar`, `osSections` |
| Naming | Customer «Деньги» vs «Бюджет» | `osSections`, `navigationPolicy` |
| Portal | Сырые `Alert` + нет чата (by design); share «без оплаты» при scope `pay` | `portal.tsx` |
| CI / качество | Clarity вне CI; ~117 TS errors; UI Playwright не в api job | `ci.yml`, `typecheck-mobile.sh` |
| Manual money | expense / create invoice / edit amount без confirm | `ManualExpenseForm`, `CreatePaymentForm`, `ExpenseDetailSheet` |

---

## 4. P2 — полировка / продукт

- OCR label `DEMO` без контекста рядом (`DocumentsHub`)
- Visual SoT drift: stage links / room detail / portal / hero
- Start stage без pre-confirm
- Setup dock прячет Repair/Budget
- Portal без чата (lite by design)
- Role narrative: нет явного «инвестор / viewer DD»
- Дубли очередей CO/accept (approvals + estimate + portal + control)
- Subscription на `Alert.alert`
- Rating default `5.0` без формулы MVP M6
- Telegram отсутствует (честный gap в доках)

---

## 5. Demo / stub (честно, но шумит на питче)

**OK в development:** SMS `demo_code` · YuKassa demo без keys · FNS verify stub · OCR DEMO · Kontur off/sandbox · email log stub · seed `+70000000001/2` · `price_parser` stub ≠ рынок.

**Вредит оценке на демо:** тройной DEMO-копирайт на portal/pay · seed attention noise · E2E-мусор в списке проектов (частично лечит `pickPrimaryDemoProject`) · `eas.json` placeholder · rating 5.0.

---

## 6. Карта связей (горизонталь)

| Связь | Статус | Что сделать |
|-------|--------|-------------|
| Приёмка ↔ Оплата | OK | Gate 409 + portal sheet — канон |
| Смета ↔ Approvals ↔ Portal lock | OK | Держать один SoT |
| График ↔ Accept orchestrator | OK | schedule accepted не обходит WA |
| Этап → Бюджет/чат/календарь | Частично | + materials / payments / docs |
| Комната → Ремонт/материалы | Разрыв | Deep links в `RoomDetail` |
| «К оплате» metric | Сломан | `budget?tab=payments` + `stageId` |
| WO done → paid | Сломан | `transition('paid')` + потом nav |
| Portal pay-only → CO | Дыра | `require accept_stage` + UI gate |
| Approvals ↔ Stage/Room | Односторонне | Обратные chips «решения» |
| Chat unread SoT | OK | `inboxSyncStore` |
| WO `paid` ↔ Payment | Разрыв | Нет FK; «оплачено» ≠ финансы |

---

## 7. Claimed vs real

| Заявлено | Факт кода | Для инвестора |
|----------|-----------|---------------|
| OS ремонта end-to-end | Экраны + SM есть | Да — как demo shell |
| Live YuKassa / Pro 990₽ | Scaffold + demo | Нет до H0 ops |
| Portal accept+pay | Код есть; E2E/CI слабо (`portal-documents` ждёт `read_only`) | Только с checklist |
| Kontur / УНЭП | off/sandbox; in_app stub | Не legal-grade |
| ФНС / Мой налог | health + demo verify | Honesty OK; live нет |
| Offline поле | Частичная очередь | Не full field OS |
| Рейтинг / marketplace | default 5.0 | Roadmap |
| Telegram/WhatsApp | Честный gap | Не врать в питче |
| Staging «80%+ ready» | Завышено в старых docs | H0 = блокер |
| Clarity Wave | Source-guards UX, не runtime money | Не замена E2E |

**Док-долг:** нет `.planning/`; PRODUCT размазан по многим файлам; MVP-SPEC §5 (старые 4 таба) расходится с README (5 dock).

---

## 8. Clarity A–W: что лочат / чего нет

**Лочат:** lean home, hubs, LoadError/EmptyAction, ActionConfirm миграции, payment honesty sheets, portal confirms (accept/lock/CO/schedule), nested `queueMicrotask`, visual SoT куски, approve asymmetries.

**Не лочат:** runtime accept→pay→webhook · live integrations · portal write-scopes E2E · chat unread (отдельные PR) · money ledger/outbox · TypeScript correctness · остатки `Alert.alert` (~59 файлов).

**Критично:** `npm run mobile:test` **не в** `.github/workflows/ci.yml`.

---

## 9. Top fixes — максимальный прирост цены

1. **H0 staging:** реальный API URL, Postgres, YuKassa keys, `h0:check:live` PASS
2. **Portal CO scope** + тест pay-only → 403
3. **Money UX:** danger tone в confirm + sticky DecisionFooter + 1 primary в PaymentSheet
4. **«К оплате» + WO paid transition**
5. **Demo checkout honesty** (amount в webhook; не врать `succeeded`) + hard-forbid demo seed на staging
6. **Rebase/merge на `main` (−195)** + money integrity
7. **CI:** `mobile:test` (Clarity) + portal accept→pay E2E
8. **Двусторонние deep links** room↔stage↔materials↔payments
9. **Investor money strip:** План / Факт / Unverified / Pending / ДО Δ
10. **Refund/cancel API** + webhook fail ≠ HTTP 200; TS baseline ↓; silent catch residuals

---

## 10. Roadmap 30 / 60 / 90

### 0–30д — без стыда на демо

- H0 live · portal CO scope · pay CTA · WO paid · danger sheet · demo checkout honesty · merge `main` · CI Clarity · `demo:investor` на staging
- **DoD:** смета → lock → accept → **live/test pay** → акт → portal link

### 31–60д — пилот подрядчика

- Pro без demo-bypass · bank CSV UX · CO→act E2E · offline accept smoke · sticky money footers · cross-links · Kontur sandbox stable · TS 117→&lt;50
- **DoD:** 1 подрядчик ведёт объект без няньки

### 61–90д — защита оценки

- FNS live · rating formula · 1С prod-export · Playwright UI green · refunds · 1–3 paid pilots · убрать все «врём про оплату» CTA
- **DoD:** narrative OS ремонта подтверждён деньгами

---

## 11. Investor demo killer list (15 мин)

| # | Killer | Pri |
|---|--------|-----|
| 1 | `eas.json` → `api-staging.example.com` | P0 |
| 2 | YuKassa не live / demo | P0 |
| 3 | Нет `h0:check:live` / paid Pro | P0 |
| 4 | Portal pay-only может approve CO | P0 |
| 5 | «К оплате» → Приёмка | P0 |
| 6 | Destructive = primary | P0 |
| 7 | Demo checkout ложный succeeded | P0 |
| 8 | Kontur off/sandbox | P1 |
| 9 | WO paid без transition | P1 |
| 10 | Approvals/materials silent catch | P1 |

**Уже можно показывать (с гидом):** lock сметы → schedule confirm → accept → pay sheet (с honesty) → documents closeout; portal accept/pay при правильных scopes; inbox badges; Documents mode chips.

---

## Итог

Покупать / питчить как готовый SaaS — **рано**.  
Развивать как ядро OS ремонта с сильным calc и правильным денежным каноном — **да**, с жёстким H0 и закрытием P0 за 2–3 недели.

Главный unlock цены сейчас **не новые фичи**, а: **live money + portal trust scopes + merge на актуальный `main` + CI на Clarity**.

---

*Канон для работы из GitHub / локального `docs/`. Cursor canvas — опциональное UI-зеркало; источник правды для команды — этот файл и чеклист Wave X.*
