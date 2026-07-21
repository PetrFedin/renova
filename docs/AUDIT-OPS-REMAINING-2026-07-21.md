# Ops status — audit checklist (факт 2026-07-21)

## Закрыто в git

| Было в чеклисте | Факт |
|-----------------|------|
| P1.10 CI `e2e:web` без `\|\| true` | **DONE** `971ecad` + later CI fixes on develop |
| JWT jti / StaleCacheBanner / outbox / schedule_version / hard-purge | **DONE** wave-10 |
| **P1.11 Slice-1 security-acl → main** | **DONE** — [PR #5](https://github.com/PetrFedin/renova/pull/5) merged; tag [v0.3.1-security-acl](https://github.com/PetrFedin/renova/releases/tag/v0.3.1-security-acl) |
| Матрица SECURITY plan | **DONE** P0/P1 code rows |

## Ещё открыто

| Item | Статус | Действие |
|------|--------|----------|
| P1.11 Slice-2+ | **NEXT** | acceptance-schedule → payments → offline → documents-fns → ia-portal |
| Live staging secrets | **ENV** | `ENVIRONMENT=staging npm run staging:credentials-probe` on staging host |
| Mega-PR #3 | **DRAFT** | do not merge |

## Команды

```bash
git rev-parse origin/main   # expect v0.3.1-security-acl / 7a4080d+
npm run split:status
ENVIRONMENT=staging npm run staging:credentials-probe
```
