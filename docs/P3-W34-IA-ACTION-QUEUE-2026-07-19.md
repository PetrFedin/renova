# P3-W34 — Sprint 2 IA: Action Queue + More ≤5

**Цель:** одна очередь дел на Home, ≤5 пунктов в «Ещё», без второго экрана уведомлений и orphan work-schedule UI.

## Изменения

| Было | Стало |
|------|--------|
| Home: строка «Входящие» + hero | Одна зона **«Очередь дел»** (`HomeActionHero`) → `/inbox` |
| `/notifications` полный экран | Redirect → `/inbox` (+ pushLinks) |
| Orphan `WorkScheduleScreen` / SummaryCard | Удалены (hub = `/calendar`) |
| Header «Ещё» без hard cap | `MAX_HEADER_MORE_ITEMS=5` + `OS_MORE_UTIL_LINKS` |
| Home more без cap | `MAX_MORE_MENU_ITEMS=5` в `menuRoutes` |
| Профиль: Архив дублировал «Ещё» | Убран из EXTRA_ITEMS |

## DoD
- `npx tsx apps/mobile/lib/routeRegistry.test.ts`
- `npx tsx apps/mobile/lib/pushLinks.test.ts`
- `npx tsx apps/mobile/lib/formatPhone.test.ts`
- Header More = Сроки + Входящие + Документы + Архив (≤5)
- Нет 3 путей к attention (только inbox)

## Scope
Только Renova. Syntha/Platform Core вне скоупа.
