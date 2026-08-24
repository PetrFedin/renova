# Renova — Production Readiness

**Статус широкого production launch:** **BLOCKED**  
**Канонический machine-readable evidence:** `docs/production-readiness-evidence.json`  
**SHA-bound snapshot:** GitHub Actions artifact `production-readiness-snapshot` из workflow `Production readiness integrity`.

Этот документ заменяет старые MVP/audit-документы как текущий источник истины по production readiness. Исторические аудиты остаются полезны как журнал решений, но не определяют текущую готовность релиза.

## 1. Как определяется текущий SHA

Git-коммит не может надёжно содержать собственный SHA: изменение записанного SHA создаёт новый commit SHA. Поэтому Renova **не хардкодит `main` SHA в этом файле**.

На каждом readiness-run `scripts/production_readiness.py`:

1. получает exact evaluated SHA из GitHub Actions;
2. читает живой `main` SHA через GitHub API;
3. вычисляет текущий Alembic head из migration graph;
4. читает mobile version/build непосредственно из `apps/mobile/app.json`;
5. проверяет живое состояние всех issues, перечисленных как launch blockers;
6. объединяет эти repo-факты с reviewable external/operator evidence manifest;
7. выпускает `production-readiness.json` и `production-readiness.md` как retained CI artifact.

Для `push` на `main` поле `current_main_sha` в generated snapshot является каноническим текущим SHA. Для PR snapshot отдельно хранит evaluated candidate SHA и current base `main` SHA.

## 2. Текущие repo-derived факты

Эти значения проверяются CI против исходников; изменение кода без обновления readiness evidence ломает gate.

| Факт | Текущее значение |
|---|---:|
| Alembic head | `w15providerops01` |
| Mobile version | `0.3.7` |
| iOS buildNumber | `3` |
| Android versionCode | `3` |
| Backend image contract | `ghcr.io/petrfedin/renova-api:sha-${GIT_SHA}` |
| Backend runtime roles | `renova-api`, `renova-worker` из одного immutable image |

## 3. Что repository CI уже доказывает

Repository-side production controls реализованы и регулярно проверяются:

- полный backend regression и PostgreSQL Alembic upgrade;
- API/UI Playwright end-to-end surface;
- dedicated API/worker runtime topology и shared Redis heartbeat truth;
- provider reconciliation ledger для YooKassa/FNS, retry/fencing/terminal recovery;
- outbox DLQ/requeue и operator health;
- push delivery + Expo receipt reconciliation;
- OTP/Redis recovery, shared rate limiting, admin RBAC/object authorization;
- CodeQL Python + JavaScript/TypeScript;
- OSV dependency audit, Gitleaks full-history/proposed-tree scan и scanner canary;
- container build, non-root runtime, Trivy fixed High/Critical gate;
- logical PostgreSQL backup → isolated restore → schema/data fingerprint verification;
- exact locked Python `3.12.13` + Poetry `2.4.1` dependency graph across focused backend CI.

Green CI **не означает**, что внешний production environment, provider credentials, capacity, store release, disaster recovery, alert delivery или security review уже доказаны.

## 4. Backend artifact identity

`Backend image integrity` строит exact-commit image, проверяет OCI revision, API/worker health, сканирует Trivy, а на `main` публикует immutable SHA-tagged image с BuildKit SBOM/provenance и keyless Sigstore signature.

Production readiness требует **конкретный registry digest**, а не только tag. Пока exact digest не приложен к evidence snapshot, состояние остаётся `UNVERIFIED_CURRENT_DIGEST` и production artifact нельзя считать подтверждённым.

После main-publish workflow pull'ит опубликованный **exact digest**, читает из него `org.opencontainers.image.revision` и fail-closed сравнивает revision с `GITHUB_SHA`. Только после этого сохраняется `backend-image-identity` с:

- `git_sha`;
- фактически прочитанным `oci_revision`;
- canonical image name;
- immutable `sha-${GITHUB_SHA}` tag;
- строгим `sha256:<64 hex>` digest;
- runtime commands `renova-api` / `renova-worker`;
- SBOM/provenance/signature contract;
- retained workflow evidence URL.

`scripts/production_readiness.py` принимает такую identity только если `git_sha`, `oci_revision`, image, tag и digest относятся к **exact evaluated SHA**. Artifact другого коммита не может подтвердить текущий release candidate.

## 5. Environment truth

| Environment | Статус | Что доказано |
|---|---|---|
| Isolated CI staging | `PASSED` | PostgreSQL/Redis/Bearer-auth/runtime topology на exact candidate |
| External production-like staging | `UNVERIFIED` | Нет retained authoritative evidence реального deployed topology и build-once/promote exact digest lifecycle; tracking #233 |
| Production | `UNVERIFIED` | Нет retained authoritative deployment SHA + image digest + runtime evidence |

Нельзя преобразовывать isolated staging CI в утверждение «staging/prod работает» без внешнего evidence. #233 остаётся P0 launch blocker, пока persistent production-like staging и promotion lifecycle не доказаны реально.

## 6. Provider readiness

| Provider | Repo-proven | Внешняя граница |
|---|---|---|
| YooKassa | durable authoritative read reconciliation, replay-safe transition, operator recovery | live credentials/liveness/rotation drill не подтверждены |
| FNS receipts | durable verification retry/reconciliation | live credentials/liveness не подтверждены |
| «Мой налог» | dedicated token keyring, legacy rewrap, expiry truth, safe health | live OAuth/provider refresh contract не подтверждён; automatic refresh не заявлен |
| Контур/e-sign | durable idempotent submit через DomainOutbox + webhook | exact authoritative read-status API для configured Контур.Сайн contract не подтверждён |
| S3/media | fail-closed configuration/runtime checks | ambiguous-write orphan/idempotency recovery остаётся открытым |
| Expo push | delivery identity + receipt reconciliation | live external provider availability не является CI-фактом |

Канонический backlog provider operations — #238.

## 7. SLO и capacity

Repository-side capacity gate из #255 реализует:

- production Bearer-auth HTTP smoke/ramp/spike/soak;
- WebSocket ticket/fan-out path;
- authenticated webhook burst path;
- >=2 exact API replicas + exact worker artifact checks;
- DB pool, Redis, worker/outbox backlog pressure signals;
- retained sanitized capacity evidence;
- launch-candidate thresholds: HTTP failures <1%, HTTP p95 <1s, p99 <2.5s; WebSocket delivery failures <1%, p95 <1s, p99 <2.5s.

**Реальная capacity/SLO всё ещё NOT PROVEN.** Protected suite должен быть выполнен против внешнего production-like staging exact SHA/image digest; retained evidence пока не подтверждено. Tracking: #236.

## 8. Restore и disaster recovery truth

Последний repository restore drill, сохранённый в readiness evidence:

- workflow run `32640629706`;
- exact head `6b583f596b7dd004273ba08044bbb0dc82a85d6e`;
- `SUCCESS`;
- PostgreSQL logical backup → isolated restore → schema verification → deterministic data fingerprint;
- это synthetic/repository drill, **не доказательство восстановления production backup**.

Production-grade backup/PITR configuration, retention и настоящий isolated restore из managed production-like backup остаются `NOT_EXTERNALLY_VERIFIED`. #234 поэтому остаётся **P0 launch blocker** до retained operator evidence с RPO/RTO и application read smoke.

## 9. Release identity

Source mobile identity сейчас: version `0.3.7`, iOS build `3`, Android versionCode `3`.

`EAS Build & Submit` сохраняет exact release identity с:

- `git_sha`;
- app version;
- iOS `buildNumber`;
- Android `versionCode`;
- EAS profile;
- requested platform;
- конкретными EAS build IDs;
- retained workflow evidence URL.

Readiness validator отклоняет EAS artifact от другого Git SHA, другой source version, другого native build number/versionCode или с неполным platform/build identity. Пока реальный retained EAS artifact/operator confirmation не существует, поле latest EAS release остаётся `NOT_EXTERNALLY_VERIFIED`.

Нельзя считать исходный `app.json` доказательством загрузки в TestFlight/App Store/Google Play.

## 10. Observability, security risk and external acceptance

Backend repository уже содержит observability controls, однако наличие кода не равно работающему production monitoring. Retained evidence реальной end-to-end alert delivery, mobile crash reporting и staging alert probe пока отсутствует. #235 остаётся **P0 launch blocker**.

Repo security controls реализованы через security-operations slice #258. OSV exception baseline пустой; CodeQL, Gitleaks и container/dependency gates обязательны в CI.

**Accepted security risks:** отсутствуют. Если residual risk будет принят, manifest требует минимум `id`, owner, expiry date и evidence. Запись без срока действия запрещена readiness validator.

Остаются внешние security blockers:

- #247 — **P0:** `main` branch protection / required production checks. Последняя GitHub metadata проверка всё ещё показывает `protected=false`;
- #256 — реальный GitHub/org privileged-access review;
- #257 — независимый pre-launch penetration/abuse test;
- #237 — общий external security acceptance, включая provider credential rotation/revocation drill.

## 11. Product integrity truth после chat red-team

Legacy red-team и clean-room исправление chat flow уточнили текущую картину. Один прежний P1 закрыт кодом и CI; два новых P1 обнаружены и не скрыты.

- **#265 — manual payment evidence verification — INCOMPLETE / P1.** Current main уже различает `paid_unverified`, но customer `transfer_ack` не заменяет полный evidence lifecycle. Для broad production нужен canonical flow: evidence upload/version → authorized reviewer approve/reject → safe resubmit → ровно одно финансовое признание. Старый PR #27 нельзя переносить напрямую: его approve path одновременно увеличивал `Project.budget_spent` и вызывал `expense_from_payment`, что несовместимо с текущей финансовой семантикой и создаёт риск double counting.
- **#266 — warranty create idempotency — INCOMPLETE / P1.** Warranty flow и fail-closed list существуют, но create остаётся без durable request identity, при этом mobile умеет повторять POST через offline queue. Double-tap, timeout-after-commit или reconnect retry могут создать duplicate issue + warranty document + события. Требуется atomic/idempotent create на текущем client-write/outbox contract.
- **#269 — chat read truth — CI VERIFIED.** PR #270, exact head `deef0d2eed413679d095f4e06d48d8bde963f759`, merge SHA `9a7b0babc530c4ed187f54ea9c67763393656763`, CI run `32734835634`. GET/list/count больше не меняют read state; public read mutation требует authoritative message cursor и двигает границу монотонно на DB-level; mobile отмечает прочитанным только после successful load + render frame + focused foreground visibility без blocking overlay; WebSocket delivery сама по себе не является read; ACK reconciliation fail-closed и не возвращает inbox к предыдущему project context. Exact head прошёл full backend regression, Playwright API/UI, CodeQL, mobile/typecheck contracts и PostgreSQL Alembic upgrade.
- **#271 — exact equal-timestamp read cursor — TRACKED P2, не launch blocker.** Current canonical state сохраняет resolved message timestamp; два сообщения с абсолютно одинаковым `created_at` могут коалесцироваться на read boundary. Это не скрыто: follow-up должен расширить тот же canonical read state стабильным total-order cursor, без второй truth table.
- **#272 — durable truthful phone chat invitation delivery — INCOMPLETE / P1.** Phone-only invite сейчас может проглотить SMS provider exception и вернуть ложный successful state. Нужны atomic invitation + delivery intent, canonical DomainOutbox/worker, idempotency, explicit queued/sent/terminal truth, retry/replay и operator recovery. Реальная доставка остаётся `NOT VERIFIED` без external staging evidence.
- **#273 — archived chat new-message visibility — INCOMPLETE / P1.** Global unread исключает archived threads, но новое входящее сообщение сейчас не возвращает recipient thread в active visibility. Требуется явная политика archive != read, mute != archive, deterministic recipient unarchive/new-unread transition и concurrency/WS reconciliation tests.

Таким образом, #269 больше не является launch blocker после merge #270, но production readiness **не улучшается искусственно**: #272 и #273 добавлены как новые P1 blockers, потому что они нарушают communication end-to-end truth.

## 12. Open launch blockers и переход состояния

Readiness manifest перечисляет launch-blocking issues и CI проверяет, что они действительно остаются `open`; если issue закрывается, manifest обязан быть пересмотрен.

- **P0 #233** — real persistent production-like staging + exact-artifact promotion lifecycle.
- **P0 #234** — managed backup/PITR + real external restore/DR evidence.
- **P0 #235** — production observability + retained alert-delivery proof.
- **P0 #247** — protect `main` and require production gates.
- **P1 #236** — real external staging capacity/provider-degradation evidence.
- **P1 #237** — external security acceptance.
- **P1 #238** — remaining e-sign authoritative-read and S3 ambiguous-write recovery.
- **P1 #241** — controlled production pilot, telemetry and launch operations.
- **P1 #256** — privileged repository/org access review.
- **P1 #257** — independent penetration/abuse test.
- **P1 #265** — complete manual bank-transfer evidence/reviewer/resubmission lifecycle on current finance truth.
- **P1 #266** — atomic, durable and idempotent warranty claim creation across retry/offline/concurrency.
- **P1 #272** — phone chat invitation delivery must stop returning false success on SMS failure and use durable recovery.
- **P1 #273** — new incoming messages must not remain hidden in archived chats or disappear from unread truth.

Readiness state machine допускает только `BLOCKED_FOR_BROAD_PRODUCTION` и `READY_FOR_BROAD_PRODUCTION`. `READY` запрещён при любом launch blocker и требует живой GitHub-проверки защищённого `main`. `BLOCKED` может иметь ноль issue-blockers только при явной непустой причине — например, когда временная блокировка ещё не представлена issue.

Тем самым readiness больше не зафиксирован навсегда в `BLOCKED`, но удалить blockers вручную недостаточно как доказательство: каждый внешний или product-integrity P0/P1 должен быть закрыт только после retained evidence и синхронного пересмотра manifest.

## 13. Обновление source of truth

При изменении migration head, mobile build/version, provider readiness, SLO/restore/release evidence или launch blockers нужно обновить `docs/production-readiness-evidence.json` в том же PR. `Production readiness integrity` проверяет consistency, live blocker states и сохраняет SHA-bound snapshot.

Readiness unit contract отдельно проверяет переходы BLOCKED/READY, exact Git SHA binding backend/EAS identity, canonical image/tag/OCI revision/digest, native mobile build identity, закрытые GitHub blockers и запрет `VERIFIED` внешнего статуса без evidence.

External/operator evidence считается подтверждённым только если в manifest есть конкретная retained evidence identity/URL/ID. Формулировки вида «настроено», «запущено», «проверено вручную» без доказательства не переводят статус в `VERIFIED`.
