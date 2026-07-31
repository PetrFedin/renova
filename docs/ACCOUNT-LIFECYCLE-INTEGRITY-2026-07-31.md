# Account lifecycle integrity — 2026-07-31

## Closed defects

1. **False soft-delete success when no refresh session existed.**
   `delete_me` prepared account mutations and then called `revoke_all_user_sessions`. The old service executed `rollback()` when the update affected zero rows, silently reverting the pending deletion before the endpoint returned `soft_deleted=true`.

2. **Non-atomic revoke-all transition.**
   Refresh-session revocation and access-token epoch invalidation were committed separately. The session service now supports `commit=False`, so the caller owns one transaction.

3. **Zombie account through `/auth/anonymize`.**
   The legacy route removed identity fields but left the account active and all tokens valid. It now uses the same canonical soft-delete transition as `DELETE /auth/me`.

4. **Hard purge callable by any authenticated user when the feature flag was enabled.**
   The purge route now requires all of the following: staging or production, `ALLOW_ACCOUNT_PURGE=true`, an authenticated contractor, a separately configured secret of at least 32 characters, constant-time secret comparison, and the exact confirmation phrase `PURGE_DELETED_ACCOUNTS`.

## Transaction contract

- Account anonymization, `deleted_at`, access-token invalidation and refresh-session revocation commit together.
- Zero active refresh sessions is a valid result and never triggers rollback of unrelated pending mutations.
- Exceptions roll back the complete soft-delete transition.
- The legacy runtime routes are removed by exact path and HTTP method; `GET /auth/me` remains intact.

## Required operations configuration

```text
ENVIRONMENT=staging|production
ALLOW_ACCOUNT_PURGE=true
ACCOUNT_PURGE_OPS_SECRET=<random secret, at least 32 characters>
```

The request must include:

```text
X-Account-Purge-Secret: <same secret>
```

and JSON:

```json
{"confirm":"PURGE_DELETED_ACCOUNTS","older_than_days":30}
```

## Remaining risks

- Hard purge can still be blocked by retained relational records; this must be handled as a separate retention/anonymization policy rather than deleting financial and project history blindly.
- There is no first-class administrator role yet. The purge endpoint therefore uses contractor identity plus an independent ops secret as defense in depth.
- Recovery/reset tokens were not found in the current API; if introduced, they must be single-use, atomic and revoke existing sessions after credential recovery.
