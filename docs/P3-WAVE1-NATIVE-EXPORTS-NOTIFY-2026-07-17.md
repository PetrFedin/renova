# P3 Wave 1 — Native PDF exports + issue notify (2026-07-17)

## Native exports (P0)

PDF/XLSX/CSV через `downloadApiPath` — iOS share sheet вместо silent no-op:
- `lib/api/os.ts`, `estimate.ts`, `rooms.ts`, `stages.ts`

## Notifications

- `pushLinks.ts` — issue, approval, deadline, waste_reminder
- `NotificationCenter.tsx` — role-aware + fallback
- `POST .../issues` — notify при создании замечания
