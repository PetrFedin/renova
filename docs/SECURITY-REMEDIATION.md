# Security remediation notes

## Policy

- Не коммитить `.env`, private keys, service-account JSON, payment credentials, Apple `.p8`, Telegram tokens.
- При обнаружении **активного** секрета в tracked files: указать **путь + тип** (не значение), ротация — вне репозитория владельцем credential.
- Не переписывать git history автоматически (`.env` в history) без явного решения security owner.

## Scan (2026-07 release-ops hardening)

| Check | Result | Evidence |
|-------|--------|----------|
| Tracked private keys / `sk_live` / `ghp_` / `AKIA` | PASS (0 hits) | `scripts/secret-scan.sh` on branch |
| `.env` gitignored | PASS | `.gitignore` line `.env` |
| Local `backend/.env` present | N/A (local only) | ignored; do not commit |

## If a secret is found later

1. Revoke/rotate at provider.
2. Remove from tree in a follow-up commit (or filter-repo if history leak — owner decision).
3. Add path to scan denylist patterns if needed.
4. Record incident date in this file (no secret values).
