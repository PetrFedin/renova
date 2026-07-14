# Merge `develop` → `main` — checklist

**Не выполнять автоматически** до зелёных критериев.

## Критерии

- [x] A-01 offline: `npm run test:offline`
- [x] A-06 env: `cd backend && python -m pytest tests/test_environment_guards.py -q`
- [x] D docs: `cd backend && python -m pytest tests/test_project_documents.py -q`
- [x] Route registry: `node apps/mobile/lib/__tests__/routeRegistry.test.mjs`
- [x] E2E: `bash scripts/e2e-smoke.sh` green 2026-07-15 (see `E2E-SMOKE-RESULTS-2026-07-15.md`)
- [x] Нет SECRET_KEY/default в staging/prod конфигах — guards + `.env.staging/.production.example` + `merge-readiness` scan (2026-07-15)
- [x] `main` отстаёт осознанно; PR package: `MERGE-DEVELOP-TO-MAIN.md` + TestFlight notes (merge вручную после review)

## Команды merge (когда готово)

```bash
git checkout main
git pull origin main
git merge --no-ff develop -m "release: merge develop (A-01..A-06, documents, registry)"
git push origin main
```

## После merge

- Tag `v0.2.0` или следующий semver
- Обновить TestFlight build notes


## Wave 2 added (2026-07-15)

Before merge also verify Document Center upload/archive/restore + foreign 404 in `scripts/e2e-smoke.sh`.


## Wave 3 added (2026-07-15)

- [x] Media membership ACL (`document_media_acl.py`)
- [x] Legal hold MVP (`POST …/legal-hold`, block delete)
- [x] OCR stub + e-sign registry (`DOCUMENT-CENTER-WAVE3B.md`) — не блокер; контракты готовы
- [ ] Реальный OCR worker / Kontur SDK — post-staging


## Wave 3c / staging Postgres (2026-07-15)

- [x] Local Postgres staging smoke script (`npm run staging:postgres`)
- [x] OCR async worker contract
- [ ] Human merge PR #2 + tag v0.2.0
