# Renova — глубокий аудит (конкуренты + тупики + UX + план)

**Дата:** 2026-07-19  
**Ветка:** `develop` @ `d8b5f27` (post-P3-W31)  
**Canvas:** Cursor `renova-competitive-audit.canvas.tsx`  
**Основание:** `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md`, `PRODUCT-AUDIT-SYNTHESIS-2026-07-19.md`, code verify, parallel agents

---

## Вердикт

Renova = **staging-ready RU B2B MVP+** (~85% ядро vs Smetter/Vition).  
До «улучшенного аналога» (Smetter/Vition + Buildertrend client + Fieldwire field) не хватает **Trust + IA cleanup + сквозных цепочек**, а не новых экранов.

**Не строить:** Procore RFI/BIM, marketplace в project chat, Stripe до RU PMF, AI-чат на каждом экране.


## Scope (обязательно)

**Только Renova** (ремонт, iPhone, customer/contractor).

**Вне скоупа — не анализировать и не планировать здесь:**
- Syntha / Platform Core / Workshop2 / fashion B2B / JOOR / Centric
- Любые «столпы» brand×shop×mfr (это другой продукт)

Следующий шаг Renova: **WP1–WP3** (live оплата + CTA после приёмки + schedule hub).


---

## Scores (perceived completeness)

| Сегмент | 15.07 | W31 | Target |
|---------|-------|-----|--------|
| RU B2B renovation | 70% | **85%** | 90% |
| Global remodel PM | 55% | **72%** | 80% |
| Field QA / punch | 50% | **68%** | 78% |
| Offline поле | 40% | **55%** | 70% |
| RU scale (1C/банк) | 25% | **30%** | 65% |

---

## Сильные стороны (оставить / усиливать)

1. Dual-role iOS (customer + contractor)
2. Calc-engine сметы
3. Golden path accept → act → pay gate
4. Document Center (версии, ACL)
5. Selections → MaterialPick → purchases
6. Plan-punch MVP
7. Portal API: accept / pay / sign (шире чем «read-only» в старых доках)
8. Budget BFF
9. Environment profiles
10. Offline queue + conflicts

---

## Must-have конкурентов — gaps

| P | Gap | Интеграция |
|---|-----|------------|
| **P0** | Live ЮKassa (не demo) | Budget + Portal + payment-return; staging keys |
| **P0** | Hardcoded demo-карта в `portal.tsx` | Реквизиты из профиля исполнителя |
| **P0** | Kontur webhook → signed_at | Document Center |
| **P1** | CO → budget delta + eSign act | Estimate «Изменения» + budget_service |
| **P1** | Hub «Сроки» (1 вход) | calendar SoT; work-schedule redirect only |
| **P1** | Offline UI parity accept/docs/issues | offlineUi + WorkAcceptance |
| **P2** | 1C export / bank CSV | integrations/onec |
| **P2** | ФНС receipt verify live | fns/receipt_verify |
| **P3** | Warranty, AI digest | retention |

---

## Лишнее / задвоенное

| Зона | Сейчас | Целевое |
|------|--------|---------|
| Приёмка | work-acceptance + control redirects | 1 surface |
| Деньги | budget + finance-center redirect + portal | Budget › Payments + sheet |
| Сроки | calendar + work-schedule + home strip | 1 hub «Сроки» |
| Уведомления | home + more + inbox + profile | Inbox SoT |
| Репо | renova / renova-os / renova v1 | только renova → sync:os |

---

## UX / IA

**Проблема:** 3 меню (dock + Разделы + Ещё), 87 route-файлов / ~20 registry, 4–5 тапов до действия.

**Target dock:** Дом · Работы · Деньги · Чат + project switcher.  
**Home:** одна Action Queue.  
**Stage:** фото + approve + чат + pay gate.

Уже сделано W21–W31: role-aware menu, guest filter, legacy redirects, offline batch, CO chip.

---

## План спринтов (полезность ≥9)

### Спринт 1 — Trust (1–2 нед)
1. YuKassa staging keys + E2E real pay  
2. Webhook idempotency  
3. Убрать hardcode реквизитов portal  
4. Kontur sandbox e2e webhook  
5. Merge/CI readiness  

**DoD:** оплата и подпись на staging без «demo» в UI.

### Спринт 2 — IA
1. Home Action Queue  
2. Schedule hub — один вход  
3. Delete 5+ legacy tab files/sprint  
4. QC = issues; без дубля acceptance  
5. More ≤ 5 пунктов  

**DoD:** routes &lt; 50; нет 3 путей к одной задаче.

### Спринт 3 — Chains
1. Portal branded + sign UI parity  
2. CO → full budget delta  
3. Punch photo + acceptance pin  
4. Offline UI parity  
5. Stage → calendar auto-write  

### P4–P5
1C/bank/FNS live · AI digest · warranty · registry≈screens · TestFlight full

---

## Demo / stub (не prod)

- Demo auth phones, SMS demo_code  
- ЮKassa demo без keys  
- Portal hardcoded bank card (**критично**)  
- Kontur off/sandbox  
- FNS verify stub  
- OCR heuristic  
- Voice/Whisper stubs (вне IA)

---

## Tracking

Обновлять после каждой волны: этот файл + `DEAD-ENDS-INVENTORY` + gap-plan scores.
