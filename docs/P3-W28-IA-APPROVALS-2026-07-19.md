# P3-W28 — IA control unify + approvals offline + YuKassa RU errors

## Изменения

- **control.tsx** (customer/contractor) → `LegacyTabRedirect` через TAB_ALIASES
- **API offline**: patchStageRooms, approve/reject change orders, material picks, room changes, rejectApproval
- **ChatThreadView** — единый `notifyOfflineQueued`
- **Backend** — 503 ЮKassa сообщения на русском

## DoD

- `npm run test:priority` PASS
- `npx tsx apps/mobile/lib/legacyRoutes.test.ts` PASS
