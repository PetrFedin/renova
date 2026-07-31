# Audit closure matrix — develop HEAD (wave-6)

> **Исторический документ.** Эта матрица фиксирует состояние старого `develop` на 2026-07-21 и больше не является текущим источником истины. Формулировка «весь code backlog закрыт» была опровергнута повторной проверкой актуального `main`: найден portal change-order scope defect и продолжается аудит transaction/replay integrity. Текущий статус: [`FULL-PROJECT-AUDIT-2026-07-31.md`](FULL-PROJECT-AUDIT-2026-07-31.md).

Ответ на «всё ли внесено?» на момент wave-6: **весь известный тогда code-embed backlog аудита P0–P2 → wave-1…6 считался закрытым**.  
Оставались **ops/credentials**, однако последующие проверки могут повторно открыть code-risk.

## P0–P2 claims → исторический статус

| # | Находка аудита | Статус на 2026-07-21 | Где |
|---|----------------|------------------------|-----|
| 1 | main ≠ develop / release | **OPS** | PR #3 + `SPLIT-RELEASE-PR-PLAN` + `scripts/split-release-status.sh` (~209 commits) |
| 2 | Auth только X-User-Id | **DONE** | JWT Bearer SoT + refresh/`user_sessions`; X-User-Id forbid staging/prod |
| 3 | Staging без SHA | **DONE tooling / OPS live** | H0 `git_sha`; `staging:readiness-report`; live check нужен HTTPS |
| 4 | Manual confirm без proof | **DONE** | receipt/transfer_ack → `paid_unverified` / `confirmed` |
| 5 | WS `/ws/chats` «удалён» | **ЛОЖЬ → DONE honesty** | endpoint жив; UI «опрос 15 с»; Redis pub/sub bridge |
| 6 | fail-open deps | **DONE** | OsWorks / StageDetail fail-closed |
| 7 | Offline banner | **DONE** | OfflineSyncStatus/Banner + reportCatch |
| 8 | Заявка 55м²/800k | **ЛОЖЬ** | CreateJobLeadSheet W140 |
| 9 | Мой налог fake linked | **DONE scaffold** | status enum + OAuth start/callback; live credentials = OPS |
| 10 | FNS verification_status | **DONE** | receipts.verification_status |
| 11 | DC badges honesty | **DONE** | Document Center mode chips |
| 12–15 | Chat amount / portal / correlation | **DONE на старом срезе** | wave-1; portal scopes повторно проверяются в Wave X |
| OTP brute-force | **DONE на старом срезе** | wave-3; atomic consume/replay требует отдельной повторной проверки |
| SecureStore | **DONE** | expo-secure-store + secureTokenStore |
| Silent `.catch(()=>{})` | **DONE wave-6** | reportCatch sweep (~89) + list-load reportError |
| Sentry | **DONE wiring / OPS SDK** | initSentry + DSN; native `@sentry/react-native` install optional |

## Waves

| Wave | SHA (approx) | Focus |
|------|--------------|-------|
| 1 | a2865dd | security, payments durable, H0, honesty |
| 2 | d6e51e2 | paid_unverified, portal CO, fail-closed finance |
| 3 | c555748 | OTP, moy_nalog_status, BudgetPayments filter |
| 4 | 428de3e | Redis subscribe, critical fail-closed |
| 5 | a44cf22 | Sentry init, OAuth scaffold, reportCatch helper |
| 6 | (this) | full silent-catch sweep + closure matrix |

## Осталось на момент документа

1. Исполнить split PR slices develop→main  
2. `npm run h0:check:live` / `staging:readiness-report` на реальном staging  
3. Выдать `MOY_NALOG_CLIENT_ID` + `TOKEN_URL` + secret  
4. При DSN: `npx expo install @sentry/react-native` и rebuild native  

Текущие задачи и новые подтверждённые риски ведутся только в `FULL-PROJECT-AUDIT-2026-07-31.md`.

```bash
bash scripts/split-release-status.sh
```
