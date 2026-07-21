# Renova — синтез аудита (конкуренты + UX + тупики)

**Дата:** 2026-07-19  
**Основание:** параллельный аудит (competitive / UX-IA / dead-ends) + `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md`  
**Ветка:** `develop` (post-P3-W30)

---

## Executive summary

Renova — **staging-ready RU B2B MVP+** (~84% vs Smetter/Vition по ядру). Moat: НПД/ФНС + рейтинг + consumer iPhone для заказчика. До «улучшенного аналога» три блока:

1. **Trust** — live ЮKassa, Kontur webhook, portal sign/pay (не demo/read-only)
2. **IA** — 87 expo-файлов vs 20 registry; дубли приёмки/графика/оплат; перегруженная главная
3. **Field** — offline UI приёмки, punch photo, guest/readOnly menu

**Не строить:** Procore RFIs/BIM, marketplace в чате, AI chatbot на каждом экране.

**Вне скоупа:** Syntha / Platform Core / fashion OS — отдельный репозиторий, не смешивать с планом Renova.
**Next:** WP1–WP3 (оплата, CTA приёмки, schedule hub).

---

## Конкуренты (must-have RU)

| Table stakes | Renova | Gap |
|--------------|--------|-----|
| Смета + plan-fact | ✅ strong | расширить базу работ (30→импорт) P4 |
| Этапы + gate pay | 🟡 contract gate P3 | live eSign |
| Клиентский портал | 🟡 read-only v1 | sign/pay P3.2 |
| Платежи по этапам | 🟡 demo ЮKassa | **P0** |
| 1С / банк | ❌ | P4 |
| Снабжение | ✅ hub P2 | retailer cart optional |
| Offline поле | 🟡 ~10 мутаций | P3.3 |
| Telegram/WhatsApp | ❌ | roadmap |

**Дифференциатор:** dual-role app + calc-engine + golden path accept→pay + Document Center.

---

## UX / IA (топ проблемы)

1. **3 меню:** dock + «Разделы» + «Ещё» на главной — cognitive overload
2. **4–5 тапов** до действия (hub → subtab → sub-subtab)
3. **Дубли:** приёмка (3 входа), сроки (calendar + work-schedule), уведомления (home + more + profile)
4. **Guest/readOnly:** `menuRoutes()` не фильтрует — гость видит beta-центры
5. **Redirect-маршруты** в UI-меню (finance-center, work-schedule) — убрать из «Ещё»

**Целевая IA:** 4 таба (Дом · Работы · Деньги · Чат) + project switcher; stage = фото + approve + чат.

---

## Тупики / demo / разрывы

| P0 | Файлы |
|----|-------|
| Offline UI приёмки | `WorkAcceptanceScreen.tsx` |
| Control tab role-split | `control.tsx` vs `OsControlScreen.tsx` |
| Push null fallback | `pushLinks.ts` |
| E-sign 501 UX | `DocumentsHub.tsx` |

| Demo (не prod) | ЮKassa demo, Kontur sandbox, OCR heuristic, FNS stub, SMS demo_code |

| Разрывы цепочки | CO→budget UI delta, stage→calendar auto-write, portal sign/pay |

---

## План (2 спринта)

**Спринт 1 — Trust:** YuKassa staging → Kontur webhook → `ci:push-workflow` → merge PR #3  
**Спринт 2 — IA:** finance-center delete screen → schedule hub → role-aware «Ещё» → delete 5 legacy tabs/sprint  
**Спринт 3 — Chain:** portal sign/pay → CO→budget → punch photo  

---

## Метрики готовности

| Метрика | Сейчас | Target |
|---------|--------|--------|
| Route files / registry | 87 / 20 | <40 / 25 |
| Dead ends (beta без CTA) | ~8 | 0 |
| RU B2B completeness | ~84% | 90% |
| Live payment staging | ❌ | ✅ |

---

## Связанные документы

- `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md` — master roadmap P3–P5
- `DEAD-ENDS-INVENTORY-2026-07-15.md` — реестр тупиков
- `MARKET-COMPETITIVE-AUDIT-2026-07-15.md` — исходный рынок
- `UX-FLOWS-RU.md` — принципы IA
---

## Прогресс P3-W23…W30 (develop)

| Блок | Статус |
|------|--------|
| Trust demo→RU 503 | 🟡 backend RU messages (W28) |
| IA control/redirect | ✅ LegacyTabRedirect (W28) |
| Field offline | ✅ batch guards W27–W30 |
| CO→budget chain | 🟡 alert+CTA budget (W30) |
| Portal pay styles | ✅ W25 |
| Guest/readOnly menu | ✅ W25–W29 |
| Punch photo web | ✅ W23 |

**Остаётся P0:** live ЮKassa keys, CI workflow scope, merge PR #3.
