# Audit closure matrix — develop HEAD (wave-6)

Ответ на «всё ли внесено?»: **весь code-embed backlog аудита P0–P2 → wave-1…6 — да**.  
Осталось только **ops/credentials** (не код без staging/секретов).

## P0–P2 claims → статус

| # | Находка аудита | Статус | Где |
|---|----------------|--------|-----|
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
| 12–15 | Chat amount / portal / correlation | **DONE** | wave-1 |
| OTP brute-force | **DONE** | wave-3 |
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

## Осталось (не код)

1. Исполнить split PR slices develop→main  
2. `npm run h0:check:live` / `staging:readiness-report` на реальном staging  
3. Выдать `MOY_NALOG_CLIENT_ID` + `TOKEN_URL` + secret  
4. При DSN: `npx expo install @sentry/react-native` и rebuild native  

```bash
bash scripts/split-release-status.sh
```
