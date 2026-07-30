# NPD and Moy Nalog truth integrity — 2026-07-30

## Problem

The previous integration could report successful tax or OAuth states without provider evidence:

- `bool("false")` evaluated to `True` for the FNS `status` field;
- all HTTP 422 responses were collapsed into one invalid-INN error;
- malformed JSON, unknown status types and timeouts were not classified;
- `/fns/check-npd` was not authenticated;
- legacy and demo routes could persist `moy_nalog_linked=True` without OAuth;
- OAuth state lived in process memory and failed across multiple instances;
- a token response was accepted without strict schema validation;
- tokens were not durably stored before the database status became `connected`.

## NPD status contract

- INN is exactly 12 ASCII digits.
- Request date is between 2019-01-01 and today.
- Provider URL must use HTTPS.
- Client timeout is 65 seconds, matching the public FNS API requirement of at least 60 seconds.
- HTTP 422 is classified by provider code:
  - `validation.failed` -> invalid request;
  - `taxpayer.status.service.limited.error` -> rate limited;
  - `taxpayer.status.service.unavailable.error` -> unavailable;
  - unknown code -> protocol error.
- `status` must be a JSON Boolean. Strings, numbers, null and missing values are protocol errors.
- A successful schema-valid provider response is marked `verified_live` even when the Boolean value is false; `is_npd=false` means a verified negative result, not a provider failure.

## Moy Nalog OAuth contract

The integration is ready only when all of these are present:

- `MOY_NALOG_ENABLED=true`;
- client ID and client secret;
- HTTPS authorize URL, token URL and redirect URI;
- Redis URL.

OAuth state:

- generated with cryptographic randomness;
- stored in shared Redis for 10 minutes;
- Redis key contains only a SHA-256 digest of the state;
- bound to one user;
- consumed exactly once.

Tokens:

- token endpoint must return HTTP 2xx JSON;
- access token is mandatory;
- token type must be Bearer;
- `expires_in` must be an integer from 60 seconds through 30 days;
- token payload is encrypted with Fernet using a key derived from `SECRET_KEY`;
- encrypted payload is stored in Redis with the provider TTL;
- `connected` is persisted only after an encrypted read-back succeeds;
- corrupt ciphertext is deleted and never treated as a connection.

## API transitions

- `/fns/check-npd` requires an authenticated user.
- Legacy `/fns/moy-nalog/link` returns HTTP 410 and never mutates the user.
- OAuth start leaves `linked=false` and sets only `authorization_started`.
- Demo callback is rejected.
- Callback sets `connected/linked=true` only after state validation, token exchange, encryption, Redis storage and read-back.
- Unlink deletes the local token before returning `revoked`.

## Legacy repair

At startup, the idempotent repair:

- clears `admin_enabled` and fake `authorization_started` links;
- changes legacy `connected` without an active encrypted token to `token_expired`;
- preserves a connected user only when the Redis token decrypts and passes the current schema.

## Regression tests

- `backend/tests/test_npd_moy_nalog_truth_integrity.py`
- `backend/tests/test_moy_nalog_truth_repair.py`

Both files are part of the mandatory backend CI gate.
