# Split release: develop → main (pin SHA)

**Pin SHA:** `a2865dd` (pre wave-2) / update to HEAD after this commit.

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
