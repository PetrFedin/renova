# P3-W19 — CI workflow push + merge readiness notes

## Цель

Зафиксировать push job `test-priority` и Playwright через `scripts/ci-playwright.sh` в GitHub Actions.

## Статус workflow push

- Локально `.github/workflows/ci.yml` содержит:
  - job **`test-priority`** → `npm run test:priority`
  - job **`playwright`** → `bash scripts/ci-playwright.sh api` + `ui`
- Push через HTTPS требует OAuth scope **`workflow`** у `gh` (без него GitHub отклоняет изменения в `.github/workflows/`).
- SSH remote `git@github.com:PetrFedin/renova.git` — **нет ключа** (`Permission denied (publickey)`).

### Разблокировка push

```bash
gh auth refresh -h github.com -s workflow
# device code в терминале → https://github.com/login/device
git push origin develop
```

## Локальная верификация

```bash
npm run test:priority                    # 49 passed (guards + mobile unit)
bash scripts/ci-playwright.sh api        # API Playwright (backend via script)
npm run merge-readiness                  # test:priority + e2e:api + cleanup
```

## Прочее

- SQLite артефакты E2E: `backend/ci-playwright*.db`, `backend/e2e-local-test.db` — в `.gitignore`.
- README: секция CI / локальная проверка.
