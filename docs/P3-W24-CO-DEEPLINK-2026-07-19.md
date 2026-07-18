# P3-W24 — CO deeplink + e-sign UX + menu invariants

## Изменения

- **approvalLinks** — `change_order` → объект/смета, слой `changes` (`estimateLayer=changes`)
- **CustomerEstimateView** — читает `estimateLayer` из URL
- **DocumentsHub** — ApiError 501 → понятный текст + fallback in_app
- **routeRegistry.test.ts** — redirect-only не в «Ещё», readOnly guest menu

## DoD

- `npx tsx apps/mobile/lib/approvalLinks.test.ts` PASS
- `npx tsx apps/mobile/lib/routeRegistry.test.ts` PASS
- `npm run test:priority` PASS
