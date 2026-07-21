# Split release: develop → main (pin SHA)

**Pin SHA:** `6dcabea` (2026-07-21, includes P1.10 CI fail-closed + wave-10).  
Update: `git rev-parse origin/develop` before each slice PR.

Helper: `npm run split:status` / `bash scripts/split-release-status.sh`

## PR #3 status

Open mega-PR https://github.com/PetrFedin/renova/pull/3 (~200+ commits) — **do not merge as one blob**.

Supersede strategy:
1. Keep #3 as tracker / close when first slice lands
2. Open slice PRs in order below (each from `release/<slice>` or path-focused branch)
3. After each merge: `git tag v0.3.<n>-<slice>` + `npm run staging:readiness-report` + `npm run staging:credentials-probe`

## Почему не один PR на 200+ коммитов

Blast radius: auth, payments, acceptance, offline, documents, portal. Один merge без послойных tags ломает «что в TestFlight».

## Порядок PR (каждый: backend tests + mobile:test slice + alembic на чистой PG + rollback note)

1. **security-acl** — JWT/refresh/sessions, X-User-Id forbid, chat payment/invoice ACL, schedule self-accept
2. **acceptance-schedule** — unified acceptance, schedule sync, fail-closed deps
3. **payments** — YuKassa, webhook durable, payment_events, paid_unverified SM
4. **offline** — outbox + sync status UI
5. **documents-fns** — verification_status, honesty badges, Moy nalog copy
6. **ia-portal** — redirects, portal lite CO, naming

После каждого merge: `git tag v0.3.<n>` + staging readiness report (`npm run staging:readiness-report`).

## Gate перед TestFlight

```bash
git rev-parse HEAD
npm run merge:check:live   # когда API_BASE=https://staging…
npm run h0:check:live
```

## Already on develop (do not re-land in slice PRs)

- Wave-1…5 audit embeds: JWT/refresh, paid_unverified, portal CO, OTP lockout, moy_nalog_status + OAuth scaffold,
  Redis WS bridge, Sentry init wiring, fail-closed UI + reportCatch sweep.

Slice PRs cherry-pick or merge-range from tags — see `scripts/split-release-status.sh`.

## Slice-1 in flight

Branch `release/security-acl` — see `docs/SLICE-1-SECURITY-ACL-2026-07-21.md` / issue #4.
