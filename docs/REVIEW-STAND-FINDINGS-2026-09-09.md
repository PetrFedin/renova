# RENOVA review stand findings — 2026-09-09

Observed while deploying the current `main` to an isolated Render review runtime.

## Confirmed defects

1. Review web export can silently auto-login as demo customer when rendered inside an iframe, skipping the intended role-selection entry.
2. Demo UI is hidden unless `EXPO_PUBLIC_DEMO=1` is explicitly present at build time.
3. A pristine canonical SQLite seed materializes the apartment on the first `ensure_demo_users()` pass; the existing reconciliation branch materializes the house only on a subsequent pass.
4. Legacy Alembic migration `i9j0k1l2m3n4_chat_enhancements.py` cannot run on SQLite because SQLite does not support the ALTER constraint operation used there. Review/E2E therefore uses the repository-supported test `create_all` path, not production migration evidence.

## Review stand contract

The review stand must begin at role selection, expose both customer and contractor demo paths, show the complete canonical project set immediately, and preserve all staging/production fail-closed policies.
