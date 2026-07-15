# Renova — инвентарь тупиков и заглушек (быстрый справочник)

**Полный контекст:** `MARKET-COMPETITIVE-AUDIT-2026-07-15.md`  
**План исправлений:** `PRODUCT-REMEDIATION-PLAN-2026-07-15.md`  
**Дата:** 2026-07-15

## Mobile — нет следующего действия

| # | Где | Симптом | Fix (фаза) |
|---|-----|---------|------------|
| M1 | Finance Center | Оплата без sheet | P0.2 |
| M2 | Home banner | Не тот экран приёмки | P0.1 |
| M3 | Repair Control | Старый API | P0.1 |
| M4 | Work Acceptance | Нет error/offline UI | P0.1 + P1.5 |
| M5 | Documents Kontur | Alert 501 | P0.4 |
| M6 | Doc без файла | Alert без upload | P0.4 |
| M7 | Design PDF | «только web» | P0.4 |
| M8 | downloadFile | «браузер» | P2.4 |
| M9 | Ical import | «только web» | P2.4 |
| M10 | Notifications | mark read only | P0.4 |
| M11 | SBP pay | alert без clipboard | P1.1 |
| M12 | project-analytics | redirect | P1.4 |
| M13 | Contractor empty | wrong role CTA | P0.4 |

## Backend — разорванная цепочка

| # | Действие | Fix |
|---|----------|-----|
| B1 | legacy stages/accept | P0.1 deprecate |
| B2 | os/acceptances/accept | P0.1 proxy |
| B3 | change orders | P0.3 notify |
| B4 | payment confirm | P0.3 notify |
| B5 | documents mutate | P0.3 activity |
| B6 | stage calendar | P1.3 |
| B7 | scan_project_reminders | P1.6 cron |
| B8 | waste reminders | P1.6 cron |

## Stub / demo (не prod)

- Demo auth, ЮKassa demo, SMS demo_code, OCR heuristic, Kontur 501, FNS verify stub, EXPO_PUBLIC_DEMO
