# Ops status — audit checklist (факт 2026-07-21)

## Закрыто в git (`origin/develop`)

| Было в чеклисте | Факт |
|-----------------|------|
| P1.10 CI `e2e:web \|\| true` | **DONE** `971ecad` (push через SSH) — на GitHub уже без `\|\| true` |
| JWT jti | **DONE** `8c55b38` |
| StaleCacheBanner | **DONE** `8c55b38` |
| Outbox worker | **DONE** `8c55b38` |
| E5 schedule_version | **DONE** `8c55b38` |
| Hard-purge accounts | **DONE** `8c55b38` (`ALLOW_ACCOUNT_PURGE`) |
| Матрица SECURITY plan | **DONE** P0/P1 code rows |
| Staging credentials probe | **DONE** `npm run staging:credentials-probe` (`4d8683d`) |

## Ещё не «merge в main» (только процесс)

| Item | Статус | Действие |
|------|--------|----------|
| P1.11 Split → main | **IN PROGRESS** | Slice PR https://github.com/PetrFedin/renova/pull/5 **CI green**; PR #3 draft. Issue #4 |
| Live staging secrets | **ENV** | На сервере staging: `ENVIRONMENT=staging npm run staging:credentials-probe` |

## Команды

```bash
git rev-parse origin/develop   # expect 4d8683d+
npm run split:status
ENVIRONMENT=staging npm run staging:credentials-probe
npm run staging:readiness-report
```
