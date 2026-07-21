# Renova — инвентарь тупиков и заглушек

**Обновлено:** 2026-07-21 · `develop` · волны **W101–W105** (journey unify)  
**Канон:** `object → estimate lock → schedule confirm → acceptance → payment → documents → closeout`

Полный контекст: `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md`, `PRIORITY-50-PLAN-2026-07-20.md`.

## Статус

| Волна | Статус |
|-------|--------|
| P0–P2.5 | ✅ DONE |
| W55–W100 | ✅ DONE (bus, chat read, badges, …) |
| **W101** notify/deep links | ✅ role + `/profile` `/design` + fallback |
| **W102** accept + estimate inbox | ✅ «Принять этап» · honest estimate-lock |
| **W103** stage bus | ✅ photo/comment/deps → `syncProjectSideEffects` |
| **W104** contractor stubs | ✅ chat invoice amounts · team errors · WO→payments |
| **W105** portal estimate + IA | ✅ portal lock/reject · «Согласования» в Ещё |
| **W106** field offline + hero accept | ✅ start/propose/schedule/purchases queue · nextAction → `/stage/[id]` |

## Ещё открыто (не код-only)

| # | Симптом | Тип |
|---|---------|-----|
| H0.1–8 | Staging HTTPS, YuKassa live, Postgres, Pro accounts | **ops** |
| H0.23 | Kontur live smoke | **ops** |
| Offline | schedule item status UI | **done W148** (SchedulePlanItems) |
| Portal | нет чата / CO write (by design lite) | **P2** |

## Дубли входов (aliases OK)

| Зона | Канон | Legacy redirect |
|------|-------|-----------------|
| Приёмка | `repair?tab=control` + `/stage/[id]` | `/work-acceptance` |
| График | `calendar` | `/work-schedule` |
| Оплаты | `budget?tab=payments` | `/finance-center` |

## Demo / stub (не prod)

YuKassa demo без keys · Kontur sandbox · OCR heuristic · FNS verify stub · SMS demo_code
