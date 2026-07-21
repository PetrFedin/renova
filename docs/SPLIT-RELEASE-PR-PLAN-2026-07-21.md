# Split release: develop → main (pin SHA)

**Pin SHA (develop):** run `git rev-parse origin/develop` before each slice.  
**Main pin after slice-1:** `v0.3.1-security-acl` (`7a4080d`, PR #5).

Helper: `npm run split:status` / `bash scripts/split-release-status.sh`

## PR #3 status

Open mega-PR https://github.com/PetrFedin/renova/pull/3 — **do not merge as one blob**.

## Порядок PR

1. **security-acl** — **DONE** PR #5 → tag `v0.3.1-security-acl`
2. **acceptance-schedule** — unified acceptance, schedule sync, fail-closed deps
3. **payments** — YuKassa, webhook durable, payment_events, paid_unverified SM
4. **offline** — outbox + sync status UI
5. **documents-fns** — verification_status, honesty badges, Moy nalog copy
6. **ia-portal** — redirects, portal lite CO, naming

После каждого merge: `git tag v0.3.<n>-<slice>` + `npm run staging:readiness-report`.

## Gate перед TestFlight

```bash
git rev-parse HEAD
npm run merge:check:live   # когда API_BASE=https://staging…
npm run h0:check:live
```

## Slice-1 note

Backend landed as a unit (JWT cannot path-cherry-pick cleanly). Later slices focus on mobile/product surfaces still only on `develop`.
