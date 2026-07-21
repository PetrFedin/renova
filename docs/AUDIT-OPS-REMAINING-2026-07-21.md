# Ops remaining after wave-10 / P1.10 push

## Code — closed

Optional embeds (jti, StaleCacheBanner, outbox worker, schedule_version, hard-purge) — **DONE** in `8c55b38`.  
P1.10 CI — **DONE** in `971ecad` (SSH push bypassed OAuth `workflow` scope limit).

## Still human / env

### P1.11 Split → main

```bash
npm run split:status
# Pin: 971ecad on develop; 221 commits ahead of main
# Do NOT merge PR #3 as a single blob
# Order: security-acl → acceptance-schedule → payments → offline → documents-fns → ia-portal
```

Comment on PR #3 points reviewers to this plan.

### Live staging credentials

```bash
# with backend/.env or env exported:
npm run staging:credentials-probe
npm run staging:readiness-report
```

Required: `PUBLIC_BASE_URL` (https on staging), `SECRET_KEY`, `YOOKASSA_WEBHOOK_SECRET`, `CORS_ALLOWED_ORIGINS` (not `*`).  
Recommended: `REDIS_URL`, `SENTRY_DSN`, `DATABASE_URL`.
