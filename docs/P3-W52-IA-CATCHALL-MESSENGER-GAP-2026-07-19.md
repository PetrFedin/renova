# P3-W52 — IA catch-all + messenger gap (2026-07-19)

## Зачем

Агенты: 87 файлов маршрутов vs ~20 в registry; `project-analytics` WIP; Telegram/WhatsApp gap.  
Нужен **один resolver** и честный gap, без фейковых «интеграций».

## Сделано

1. `resolveCatchAllSlug` — legacy + registry redirects (`project-analytics` → budget/deviations).  
2. `[slug].tsx` — stack / redirect / честный 404.  
3. Registry: `design` redirect.  
4. `messengerGap` + Share copy; portal / invite honesty.  
5. `docs/TELEGRAM-WHATSAPP-GAP-PLAN-2026-07-19.md`.

## Проверка

```bash
cd apps/mobile && npx tsx lib/resolveCatchAllSlug.test.ts && npx tsx lib/messengerGap.test.ts
```
