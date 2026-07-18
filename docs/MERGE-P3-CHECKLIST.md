# Merge checklist — P3 (develop → main)

## Автоматически

```bash
npm run merge:check
npm run release:notes:v0.3
```

Включает: `test:priority`, API e2e, Playwright UI (portal + contract gate), staging smoke.

## Ручное перед PR

- [ ] Backend staging: `docs/STAGING-KONTUR.md` — env и webhook
- [ ] Smoke archive/trash на web после hard refresh
- [ ] TestFlight notes при необходимости

## P3 highlights (develop)

- Project lifecycle (archive/trash, scroll, access_mode)
- Portal + documents E2E (API + browser)
- Contract gate UI banner + API golden path
- Offline: drop queue jobs on archive/trash
- Reports в меню «Ещё»
