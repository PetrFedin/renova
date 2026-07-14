# Merge `develop` → `main` — checklist

**Не выполнять автоматически** до зелёных критериев.

## Критерии

- [ ] A-01 offline: `npm run test:offline`
- [ ] A-06 env: `cd backend && python -m pytest tests/test_environment_guards.py -q`
- [ ] D docs: `cd backend && python -m pytest tests/test_project_documents.py -q`
- [ ] Route registry: `node apps/mobile/lib/__tests__/routeRegistry.test.mjs`
- [ ] E2E: `bash scripts/e2e-smoke.sh` (acceptance → documents содержит act)
- [ ] Нет SECRET_KEY/default в staging/prod конфигах
- [ ] `main` отстаёт осознанно; PR с описанием рисков

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
