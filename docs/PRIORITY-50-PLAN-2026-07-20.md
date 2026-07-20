# Renova — топ-50 приоритетов (ошибки, тупики, демо, недостающие функции)

Дата: 2026-07-20 · ветка `develop` @ `4e48823` · канон:  
`object → estimate lock → schedule confirm → acceptance → payment → documents → warranty/closeout`

Источники: journey-аудит (заказчик / исполнитель / данные), W55–W64, H0 runbook, staging checklists.

**Как читать:** `P0` — без этого нельзя честный пилот/инвестор; `P1` — ломает контроль или доверие в golden path; `P2` — UX/честность/демо; `P3` — важные отсутствующие опции для зрелого продукта.

---

## Сводка

| Класс | Кол-во | Фокус |
|-------|--------|--------|
| P0 | 12 | Ops пилота + остатки honesty |
| P1 | 14 | Контроль, уведомления, симметрия действий |
| P2 | 12 | Демо-заглушки, дубли, polish |
| P3 | 12 | Недостающие функции продукта |
| **Итого** | **50** | |

Уже закрыто (не в списке): W55–W64 (nextAction, Purchase→Expense, mutual propose gate, portal scopes, closeout/warranty customer-only, picks approved-only, issue→fixed и т.д.).

---

## P0 — пилот и критичная честность (1–12)

| # | Что не так | Почему важно | Тип | Критерий готовности |
|---|------------|--------------|-----|---------------------|
| 1 | Нет реального HTTPS staging API в `eas.json` | TestFlight бьёт в пустоту | ops | `h0:check:strict` PASS |
| 2 | Нет live YuKassa на staging | Карта → 503 / ложный demo | ops | `payments_mode=live` |
| 3 | Demo pay не выключен на staging | Инвестор видит фейк-оплату | ops | `demo_allowed=false` |
| 4 | TestFlight без staging API env | Пилот на localhost | ops | ASC build smoke |
| 5 | `PUBLIC_BASE_URL` не HTTPS | Portal magic-link ломается | ops | portal URL HTTPS |
| 6 | Postgres+Alembic staging не доказан | SQLite в prod-профиле | ops | STAGING-POSTGRES-SMOKE |
| 7 | Нет 2–3 paid Pro для демо | Assign/paywall не показать | ops | paid Pro accounts |
| 8 | `h0:check:live` не прогнан | Нет DoD инвестора | ops | ready_for_investor |
| 9 | ~~Reject/withdraw estimate propose~~ | **W65** | gap | **закрыто** |
| 10 | ~~Portal schedule reject UI~~ | **W65** | gap | **закрыто** |
| 11 | ~~Contractor pending invoices~~ | **W65** | honesty | **закрыто** |
| 12 | ~~Closeout deep-links~~ | **W65** | UX | **закрыто** |

---

## P1 — контроль и симметрия (13–26)

| # | Что не так | Тип |
|---|------------|-----|
| 13 | Portal acceptance return | **done W66** |
| 14 | Approvals hub unified approve | **done W66** |
| 15 | CTA «подписать договор» после lock | **done W66** |
| 16 | `rejection_reason` в UI графика | **done W66** |
| 17 | Schedule create/submit contractor-only | **done W66** |
| 18 | ordered ≠ approved (purchases only) | **done W66** |
| 19 | checklist budget без progress proxy | **done W66** |
| 20 | Audit: hub approve пишет activity (+ notify) | **lite W66** |
| 21 | Hub approve → notify contractor | **done W66** |
| 22 | Inbox «Подтвердить исправления» (fixed) | **done W66** |
| 23 | Kontur/e-sign live smoke | **ops** (нужен Kontur) |
| 24 | Offline UX + approve в очереди | **done W66** |
| 25 | Push deep-link smoke expanded | **done W66** |
| 26 | Propose TTL 14д → proposal_stale | **done W66** |

---

## P2 — демо / заглушки / дубли (27–38)

| # | Что не так | Тип |
|---|------------|-----|
| 27 | Demo login gated by EXPO_PUBLIC_DEMO | **done W67** |
| 28 | E-sign 501 с message для UI | **done W67** |
| 29 | OCR label «демо-классификация» | **done W67** |
| 30 | Единый глагол «Принять этап» | **done W67** |
| 31 | /work-acceptance → repair?tab=control | **done W67** |
| 32 | Chat invoice → Бюджет/Оплаты | **done W67** |
| 33 | Punch = QC issue (labels) | **done W67** |
| 34 | Export honesty «не live-синк» | **done W67** |
| 35 | Team QR Pro hint + CTA | **done W67** |
| 36 | uvicorn websockets warnings | **ops** (deps staging) |
| 37 | Локальный дрейф ci.yml | **ops** (не коммитим без scope) |
| 38 | TS2786 JSX noise | **eng** (отдельный cleanup) |

---

## P3 — важных функций ещё нет (39–50)

| # | Функция | Зачем |
|---|---------|-------|
| 39 | Diff сметы before lock | **done W68** |
| 40 | Частичная оплата этапа % | **queued** (следующий инкремент) |
| 41 | Синк календаря Google/Apple | **lite** — есть ICS export |
| 42 | Шаблоны объектов | **queued** |
| 43 | Роли бригады/прораб | **done W68** (owner gate + teamRole) |
| 44 | Обязательные фото приёмки | **done W68** |
| 45 | SLA hours_waiting в portal | **done W68** lite |
| 46 | Авто PDF акт + notify | **done W68** (уже был act, усилили) |
| 47 | Portal: смета read-only | **done W68** |
| 48 | НДС/налог в смете | **queued** |
| 49 | Маржа plan vs fact | **queued** |
| 50 | Эскалация/спор | **queued** |

---

## Волны

1. **H0 (1–8)** — только ops  
2. **W65 (9–16)** — control gaps  
3. **W66 (17–26)** — honesty  
4. **W67 (27–38)** — demo-clean  
5. **W68 (39–50)** — product по спросу (сначала 39, 44, 46, 43)

## DoD пилота

- [ ] 1–8 PASS  
- [ ] 9–12 закрыты или явно приняты как риск  
- [ ] Golden path на staging без тупика  
- [ ] Нет кнопок в 501/503 без честного текста  

Canvas: `renova-priority-50.canvas.tsx`


## Прогресс волн

| Волна | Пункты | Статус |
|-------|--------|--------|
| H0 | 1–8 | **ops** — нужны staging URL + YuKassa + TestFlight (не код) |
| W65 | 9–12 | **закрыто** `develop` |
| W66 | 13–26 | **закрыто** `develop` (см. ниже; #23 ops) |
| W67 | 27–38 | **закрыто** `develop` (#36–38 ops/eng частично) |
| W68 | 39–50 | **частично** `develop` (39,43–47; 40–42/48–50 lite/ops) |
