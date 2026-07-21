# Slice 1: security-acl → main

**Branch:** `release/security-acl`  
**Issue:** https://github.com/PetrFedin/renova/issues/4  
**Base:** `main` @ `6cc7f16`  
**Pin develop:** `6dcabea`

## Scope in this PR

- Full `backend/` from develop (JWT SoT replaces X-User-Id; ACL/OTP/sessions/jti cannot land without matching models/migrations/routes)
- CI fail-closed `e2e:web` (P1.10)
- Mobile auth path: `secureTokenStore`, `api/client|auth`, `RenovaContext`, WS ticket helpers, `StaleCacheBanner`
- Ops scripts: staging credentials probe, split status

## Explicitly NOT in this PR (later slices)

- Full mobile IA / portal UI / materials hubs (remain on develop until acceptance-schedule / payments / ia-portal slices)
- Mega-PR #3 — do not merge

## Review focus

1. `backend/app/api/deps.py`, `core/request_auth.py`, `services/session_service.py`, `services/chat_acl.py`
2. `services/otp_service.py`, `schedule_item_transitions.py`, CORS/HTTPS in `config.py` / `environment.py`
3. Alembic: `y9z0…sessions…` through `c3d4…jti…` (+ intermediate chain required for linear history)
4. `.github/workflows/ci.yml` — no `|| true` on e2e

## DoD

- [ ] Backend JWT/ACL/OTP tests green in CI
- [ ] `alembic upgrade head` on clean PG
- [ ] After merge: tag `v0.3.1-security-acl`
- [ ] Staging: `ENVIRONMENT=staging npm run staging:credentials-probe`
