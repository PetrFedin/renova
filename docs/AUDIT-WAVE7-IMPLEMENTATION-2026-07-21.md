# Audit wave-7 — phases B–D embed (2026-07-21)

Продолжение `SECURITY-AUDIT-REMEDIATION-PLAN-2026-07-21.md` после wave-6 / SecureStore fix.

## Встроено

| ID | Что | Зачем |
|----|-----|--------|
| B | Webhook `SELECT FOR UPDATE` + amount/currency/yookassa_id | Нет двойного budget / mismatch |
| B | staging/prod: `YOOKASSA_WEBHOOK_SECRET` обязателен | Нельзя skip secret |
| C | `schedule_item_transitions` matrix | Нелегальные статусы → 409 |
| D | staging `require_https_public_url=True` | Пилот только HTTPS |
| D | CORS allowlist (`CORS_ALLOWED_ORIGINS`) | Не `*` + credentials в prod |
| D | CI: `e2e:web` без `\|\| true` | Красный CI при падении Playwright |
| D | OTP: `secrets.randbelow` + 60s resend cooldown | Production-grade OTP gen |

## Env

```bash
CORS_ALLOWED_ORIGINS=https://app.example.com,https://portal.example.com
YOOKASSA_WEBHOOK_SECRET=...
PUBLIC_BASE_URL=https://api-staging.example.com
```

## Тесты

```bash
cd backend && .venv/bin/pytest tests/test_schedule_item_transitions.py tests/test_otp_rate_limit.py tests/test_environment_guards.py -q --noconftest
```

## CI (локально, не в 4948622)

Изменение `.github/workflows/ci.yml` (`e2e:web` без `|| true`) осталось **uncommitted**:
OAuth app без scope `workflow` отклоняет push файлов workflow.

Запушить вручную (PAT с `workflow` или `gh auth` с нужным scope):

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fail closed on e2e:web"
git push
```
