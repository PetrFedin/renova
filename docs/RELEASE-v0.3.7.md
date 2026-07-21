# Renova v0.3.7 — 2026-07-21

Post split-release hardening on `main` after `v0.3.6-ia-portal`.

## Highlights

- **Auth / ops:** E2E JWT Bearer (`authHeaders`), staging credentials probe, H0 live Bearer + `auth_bearer` check (#18–#20)
- **Schedule:** plan-item status CTAs in calendar hub (#21)
- **QC:** `IssueFixed` activity + notify customer on mark-fixed / contractor on confirm (#22)
- **Hygiene:** `utc_now()` replaces deprecated `datetime.utcnow()` across backend (DB-compatible naive UTC)

## Versions

- App: `0.3.7` (iOS build 3 / Android versionCode 3)
- API `/health.version`: `0.3.7`

## Verify

```bash
npm run h0:check
npm run assert:e2e-bearer
cd backend && poetry run pytest -q
```
