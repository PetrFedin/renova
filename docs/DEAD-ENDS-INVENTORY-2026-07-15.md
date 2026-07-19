# Renova — инвентарь тупиков и заглушек (быстрый справочник)

**Полный контекст:** `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md` (master)  
**Исходный аудит:** `MARKET-COMPETITIVE-AUDIT-2026-07-15.md`  
**План исправлений:** `PRODUCT-REMEDIATION-PLAN-2026-07-15.md`  
**Дата создания:** 2026-07-15 · **Обновлено:** 2026-07-19 (post-P3-W30)

## Статус волн

| Волна | Статус | Док |
|-------|--------|-----|
| P0 | ✅ DONE | `P0-ACCEPTANCE-UNIFY-2026-07-16.md` |
| P1 | ✅ DONE (scaffold) | `P1-WAVE1` … `P1-WAVE3` |
| P2 | ✅ DONE | `P2-WAVE1` … `P2-WAVE5` |
| P3–P5 | 📋 Planned | `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md` §7 |

## Mobile — нет следующего действия

| # | Где | Симптом | Fix (фаза) | Статус |
|---|-----|---------|------------|--------|
| M1 | Finance Center | Оплата без sheet | P0.2 | ✅ sheet + redirect |
| M2 | Home banner | Не тот экран приёмки | P0.1 | ✅ work-acceptance |
| M3 | Repair Control | Старый API | P0.1 | ✅ workAcceptancesApi |
| M4 | Work Acceptance | Нет error/offline UI | P0.1 + P1.5 | 🟡 offline UI + banner (W22–W28) |
| M5 | Documents Kontur | Alert 501 | P0.4 + P2.1 poll | ✅ hide + poll |
| M6 | Doc без файла | Alert без upload | P0.4 | ✅ CTA upload |
| M7 | Design PDF | «только web» | P0.4 | ✅ native picker |
| M8 | downloadFile | «браузер» | P2.4 | ✅ expo-sharing |
| M9 | Ical import | «только web» | P2.4 | ✅ DocumentPicker |
| M10 | Notifications | mark read only | P0.4 | ✅ resolveNotificationLink |
| M11 | SBP pay | alert без clipboard | P1.1 | ✅ полные реквизиты (W25) |
| M12 | project-analytics | redirect | P1.4 | 🔴 wip → P3.5b delete/promote |
| M13 | Contractor empty | wrong role CTA | P0.4 | ✅ role=contractor |

## Backend — разорванная цепочка

| # | Действие | Fix | Статус |
|---|----------|-----|--------|
| B1 | legacy stages/accept | P0.1 deprecate | ✅ 410 |
| B2 | os/acceptances/accept | P0.1 proxy | ✅ proxy |
| B3 | change orders | P0.3 notify | ✅ |
| B4 | payment confirm | P0.3 notify | ✅ |
| B5 | documents mutate | P0.3 activity | ✅ |
| B6 | stage calendar | P1.3 | 🟡 SoT doc → P4.1d auto-write |
| B7 | scan_project_reminders | P1.6 cron | ✅ worker |
| B8 | waste reminders | P1.6 cron | ✅ worker |
| B9 | CO → budget delta | P3.2c | 🟡 UI alert → budget (W30) |
| B10 | selection → MaterialPick | P2.4 | ✅ |
| B11 | YuKassa live | P3.1a | 🟡 demo + scaffold |
| B12 | Kontur webhook | P3.1d | 🟡 dev simulate |

## Stub / demo (не prod)

- Demo auth, ЮKassa demo (dev/test без keys), SMS demo_code, OCR heuristic, Kontur off→hidden, FNS verify stub, EXPO_PUBLIC_DEMO
- **Новое post-P2.5:** portal read-only (sign/pay = P3.2), punch coords без photo (P3.3a)

## Дубли входов (остаток)

| Зона | Count | Target wave |
|------|-------|-------------|
| Приёмка | 2 (work-acceptance + control tab) | P3.4c |
| Schedule | 3 | P3.4b |
| Payments | 2–3 (budget + finance-center redirect) | P3.4a |
| Routes 87 vs registry 20 | gap | P3.5 / P5.3 |
