# Audit wave-10 — closure of remaining items (2026-07-21)

## Code embedded

| Item | Status |
|------|--------|
| JWT `jti` + `tokens_invalid_before` on revoke-all | DONE |
| `StaleCacheBanner` in OS tabs layout | DONE |
| Outbox background worker (15s) | DONE |
| E5 `schedule_version` / `supersedes_id` | DONE |
| Hard-purge `POST /auth/admin/purge-deleted-accounts` (`ALLOW_ACCOUNT_PURGE`) | DONE |
| SECURITY plan matrix synced to code fact | DONE |

## Ops (needs human / token)

### P1.10 CI workflow push

Локально `ci.yml` уже без `|| true`. Push требует scope `workflow`:

```bash
gh auth refresh -h github.com -s workflow,repo,read:org,gist
bash scripts/push-ci-workflow.sh
```

### P1.11 Split → main

```bash
bash scripts/split-release-status.sh
bash scripts/split-release-open-next.sh security-acl
# optional: bash scripts/split-release-open-next.sh security-acl --create-branch
```

Не авто-merge 200+ коммитов — slice PR по плану.

### Live staging credentials

```bash
bash scripts/staging-readiness-report.sh
# checklist: HTTPS PUBLIC_BASE_URL, YOOKASSA_WEBHOOK_SECRET, CORS allowlist, REDIS_URL, SENTRY_DSN
```
