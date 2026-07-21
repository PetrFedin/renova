# План доработки по security/product ревью (2026-07-21)

**База:** `develop` @ `f6b8f46`  
**Контекст:** ревью смешивает уже закрытое (waves 1–6) и реальные P0/P1/P2. Ниже — **факт по коду** + план работ, встраиваемый в процесс (planner / split release).

---

## 0. Вердикт: что уже лучше (не переделывать)

Эти пункты ревью «Что стало лучше» **подтверждены** и считаются DONE:

| Тема | Статус |
|------|--------|
| JWT Bearer SoT, X-User-Id только dev/test | DONE |
| Self-accept графика закрыт + cascade приёмки | DONE |
| Приёмка: customer-only, фото, единый список | DONE (см. P1 #15 checklist policy) |
| Платежи: proof / paid_unverified / YuKassa create ≠ paid | DONE (см. P0 #2–5 residual) |
| WS JWT + reconnect/poll honesty | DONE (см. P2 #19–20) |
| Job lead форма без 55 м² / 800k | DONE (см. P2 #17–18 address/quotes) |
| Env guards + Alembic PG в CI | DONE |
| Sessions/refresh/SecureStore/OTP rate-limit | **DONE** (waves 1–10: sessions, revoke-all, jti, Redis OTP) |
| Redis WS bridge | DONE opt-in |
| Silent catch / reportError | DONE wave-6 |

---

## 1. Матрица: ревью → факт → приоритет

| # | Утверждение ревью | Факт на develop | Приоритет | Действие |
|---|-------------------|-----------------|-----------|----------|
| P0.1 | REST chat ACL дыры | **DONE** — `require_chat_access` / `require_chat_message` (wave A/`58bfa2a`) | **P0** | — |
| P0.2 | confirm: commit до проверок | **DONE** (wave A) | **P0** | — |
| P0.3 | chat confirm = transfer_ack | **DONE** — finance_action / deep-link only (wave A) | **P0** | — |
| P0.4 | webhook idempotency | **DONE** — durable + FOR UPDATE (wave-7) | **P0** | — |
| P0.5 | webhook amount/secret weak | **DONE** — secret required staging/prod + amount/currency (wave-7) | **P0** | — |
| P0.6 | schedule edit after submitted | **DONE** — submitted freeze + manage ACL (wave A) | **P0** | — |
| P0.7 | item status transition matrix | **DONE** — `schedule_item_transitions` (wave-7) | **P0** | — |
| P1.8 | no sessions | **DONE** — sessions + revoke-all + jti + tokens_invalid_before (wave-10) | **P1** | — |
| P1.9 | OTP not prod | **DONE** — secrets + cooldown + Redis when `REDIS_URL` | **P1** | — |
| P1.10 | CI `e2e:web \|\| true` | **LOCAL FIX** — ci.yml готов; push blocked без scope `workflow` → `scripts/push-ci-workflow.sh` | **P1** | user: `gh auth refresh -s workflow` |
| P1.11 | PR #3 too big | **OPS** | **P1** | split release slices (уже план) |
| P1.12 | staging HTTPS soft | **DONE** (wave-7) | **P1** | — |
| P1.13 | CORS `*` | **DONE** (wave-7) | **P1** | — |
| P1.14 | cache masks errors | **DONE** — meta + `StaleCacheBanner` (wave-10) | **P1** | — |
| P1.15 | inline accept без checklist | **DONE** — quick/full + inline 409 | **P1** | — |
| P1.16 | accept commit before side-effects | **DONE** — outbox + background worker (wave-10) | **P1** | — |
| P2.17 | lead address public | **DONE** (wave-8) | **P2** | — |
| P2.18 | first quote wins | **DONE** (wave-8) | **P2** | — |
| P2.19 | WS single-process | **DONE opt-in** Redis bridge | **P2** | document REDIS_URL for multi |
| P2.20 | WS token in query | **DONE** (wave-8) | **P2** | — |
| P2.21 | DELETE /me destructive | **DONE** soft-delete (wave-8) | **P2** | hard purge job later |

---

## 2. Цель и критерий «пилот готов»

**Пилот (TestFlight + staging HTTPS)** разрешён только когда:

1. Все **P0.1–P0.7** merged в `develop` + зелёный CI (без `|| true` на критичных jobs).  
2. Slice **security-acl** смержен в `main` (или tagged) по `SPLIT-RELEASE-PR-PLAN`.  
3. Live: `npm run h0:check:live` + `staging:readiness-report` на HTTPS.  
4. YuKassa webhook secret обязателен на staging; CORS не `*`.

P1 желательны до внешнего пилота; P2 — после пилота / milestone 2.

---

## 3. План реализации по фазам

### Фаза A — Security hotfix (P0 chat + payment) — 1–2 дня

**Зачем:** закрыть IDOR/inconsistency до любого merge в main.

#### A1. `require_chat_access` helper

Файл: `backend/app/api/deps.py` или `backend/app/services/chat_acl.py`

```text
require_chat_access(db, project_id, thread_id, user, *, write) -> (Project, ChatThread)
require_chat_message(db, thread, message_id) -> ChatMessage
```

Правила:

- `require_project(..., write=)`
- `thread.project_id == project.id` иначе 404
- опционально: participant / project member для write

Применить в `backend/app/api/v1/chats.py` ко всем:

`list/create/get/read/participants/invite/messages/confirm/react/pin/task/invoice/search/export`

**Особенно:**

- `_post_message` — сейчас только thread bind, **нет** `require_project`
- `mark_read` — **нет** никаких проверок
- `react` / `pin` — добавить `require_chat_message`

Тесты: `tests/test_chat_acl.py` — чужой user → 403/404 на send/read/react/confirm.

#### A2. Confirm order fix (P0.2)

В `_confirm_message`:

1. `require_chat_access` write  
2. найти message, тип confirm|payment  
3. если payment → только `project.customer_id`  
4. **не** ставить `msg.confirmed` до успеха finance  
5. для payment: **не** вызывать `confirm_payment` из чата (см. A3)  
6. один `commit` в конце

#### A3. Chat ≠ finance (P0.3)

- Endpoint confirm для `payment` сообщений: возвращает `{ ok, payment_id, deep_link }` **без** смены PaymentStatus  
- Mobile: кнопка «Подтвердить оплату» → `PaymentDetailSheet` / budget payments  
- Канон finance: только `POST /payments/{id}/confirm` с телом `{ payment_method, transfer_ack?, receipt_id? }`

Тест: chat confirm не меняет `payments.status` / `budget_spent`.

**DoD A:** ACL tests green; confirm order test; chat confirm не трогает budget.

---

### Фаза B — Payments webhook harden (P0.4–P0.5) — 1–2 дня

#### B1. Одна транзакция webhook

```text
BEGIN
  INSERT payment_webhook_events(event_id)  -- UNIQUE → duplicate exit
  SELECT payment FOR UPDATE
  verify amount/currency/status/yookassa_id/metadata
  confirm_payment / attach
  expense + budget
COMMIT
```

Убрать опору на `_seen_keys` как SoT (оставить только cache).

#### B2. Verify payload

- staging/prod: `YOOKASSA_WEBHOOK_SECRET` **обязателен** (env policy)  
- сравнить `obj.amount.value` с `payment.amount` (tolerance 0.01)  
- currency RUB  
- `yookassa_payment_id` match если уже привязан  
- optional: retrieve payment from YuKassa API when keys set

**DoD B:** concurrent webhook test (2 parallel) → budget +1 once; missing secret → fail boot staging.

---

### Фаза C — Schedule integrity (P0.6–P0.7) — 1–2 дня

#### C1. Freeze submitted

`update_schedule`: запрет если status ∈ `{submitted, confirmed, archived}`  
`rejected` → только переход в draft + edit  
ACL: в начале `can_manage_schedule` (сейчас user почти не используется)

#### C2. Item transition matrix

Модуль `schedule_item_transitions.py`:

| From → To | Roles |
|-----------|-------|
| planned → ready | contractor/foreman |
| ready → in_progress | contractor/foreman |
| in_progress → submitted | contractor/foreman |
| submitted → accepted | **customer only** + acceptance exists |
| submitted → rework | customer |
| * → blocked / cancelled | contractor/foreman (+ rules) |

Любой другой переход → 409.

**DoD C:** tests for submitted edit 409; illegal transitions 409; accepted still customer-only.

---

### Фаза D — Platform hardening P1 (пилот) — 2–4 дня

| ID | Работа | Файлы / скрипты |
|----|--------|-----------------|
| D1 | staging `require_https_public_url=True` | `environment.py` |
| D2 | CORS allowlist env | `main.py`, `.env.example` |
| D3 | CI: убрать `e2e:web \|\| true`; job `test:guards` + chat ACL | `.github/workflows/ci.yml` |
| D4 | OTP → Redis (fallback memory only development) | `otp_service.py` |
| D5 | OTP `secrets.randbelow`; resend cooldown 60s | same |
| D6 | JWT jti optional + revoke-all endpoint UX | `session_service`, profile |
| D7 | Cache stale metadata на клиенте (finance screens) | `api/client` cache |
| D8 | `acceptance_policy` per stage; inline accept только `quick` | acceptance API + UnifiedAcceptanceList |
| D9 | Transactional outbox для notify/activity после accept | new table + worker |

**DoD D:** staging policy rejects http URL; CI red on playwright fail; OTP multi-instance safe with REDIS_URL.

---

### Фаза E — Product P2 (после пилота) — 3–5 дней

| ID | Работа |
|----|--------|
| E1 | Lead address: city/district until assigned |
| E2 | `job_lead_quotes` + customer pick |
| E3 | WS ticket (short-lived) instead of long JWT in query |
| E4 | Account deletion: soft request + retention + anonymize |
| E5 | Schedule versioning (`schedule_version`, supersedes) |

---

### Фаза F — Release process (параллельно с A–D)

Уже есть: `docs/SPLIT-RELEASE-PR-PLAN-2026-07-21.md`, `scripts/split-release-status.sh`, PR #3.

**Интеграция в процесс:**

```text
Каждый день / чат агента:
1. bash scripts/split-release-status.sh
2. npm run planner:next   # если используется planner
3. Только claimed slice / phase из этого плана (A→B→C→D)
4. Тесты фазы → commit develop → не раздувать PR #3 новыми фичами
5. Slice PR в main по порядку: security-acl → acceptance-schedule → payments → …
```

**Правило:** новые фичи marketplace/IA **не** в PR #3 до закрытия Фазы A–C.

Tags после каждого slice: `v0.3.<n>-security` и т.д.

---

## 4. Порядок коммитов (рекомендуемый)

1. `fix(security): require_chat_access on all chat REST`  
2. `fix(payments): chat confirm order + no transfer_ack from chat`  
3. `fix(payments): webhook FOR UPDATE + amount verify + secret required`  
4. `fix(schedule): freeze submitted + item transition matrix`  
5. `chore(ci): fail on e2e.web; add chat acl tests`  
6. `fix(ops): staging HTTPS + CORS allowlist`  
7. `feat(auth): Redis OTP + secrets`  
8. … P1 acceptance_policy / outbox  
9. Split merge security-acl → main  

---

## 5. Оценка трудозатрат

| Фаза | Effort | Блокер пилота |
|------|--------|---------------|
| A Chat/Payment P0 | 1–2 d | **Да** |
| B Webhook P0 | 1–2 d | **Да** |
| C Schedule P0 | 1–2 d | **Да** |
| D Platform P1 | 2–4 d | Желательно |
| E Product P2 | 3–5 d | Нет |
| F Split release | ongoing | **Да** (процесс) |

**Минимум до пилота:** A + B + C + D1–D3 + F (первый slice).

---

## 6. Риски и зависимости

- Redis нужен для OTP multi-instance и уже для WS bridge — один `REDIS_URL`.  
- Смена chat confirm UX ломает e2e, которые ждут finance из чата — обновить mobile + e2e.  
- `SELECT FOR UPDATE` требует PostgreSQL (staging/prod); SQLite local — skip/no-op.  
- PR #3 не принимать целиком; иначе review снова пропустит ACL.

---

## 7. Следующий конкретный шаг

**Начать Фазу A1–A3** в отдельной ветке `fix/chat-acl-payment-confirm` от `origin/develop`, без новых product-фич.

Критерий готовности шага: `pytest tests/test_chat_acl.py tests/test_chat_payment_confirm.py -q` зелёный + mobile deep-link на PaymentDetailSheet.

## Progress log

- 2026-07-21: SecureStore web crash fixed (`isAvailableAsync` + Platform.OS web → AsyncStorage).
- 2026-07-21: Phase A started — `require_chat_access` on send/read/participants/react/pin/invite/task/invoice/confirm; chat payment confirm no longer calls `confirm_payment`; schedule `submitted` freeze + manage ACL.

- 2026-07-21: Phase B — webhook FOR UPDATE + amount/currency/yookassa_id verify; staging/prod webhook secret required.
- 2026-07-21: Phase C — item transition matrix (`schedule_item_transitions`).
- 2026-07-21: Phase D — staging HTTPS required; CORS allowlist; CI e2e without `|| true`; OTP secrets + 60s resend cooldown.
- 2026-07-21: Hotfix MaterialPickList + UnifiedScheduleView broken imports (SyntaxError).
- 2026-07-21: Phase E — lead address privacy, job_lead_quotes+accept, soft DELETE /me, WS tickets + mobile buildWsAuthQuery.
- 2026-07-21: Wave-9 P1 — acceptance_policy, domain_outbox, Redis OTP, revoke-all, cachedGet stale meta.

- 2026-07-21: Wave-10 — jti + tokens_invalid_before; StaleCacheBanner; outbox worker; schedule_version; hard-purge endpoint; plan matrix sync; CI push helper (`scripts/push-ci-workflow.sh`); split-release next script.
