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

Green CI **не означает**, что внешний production environment, provider credentials, capacity, store release или security review уже доказаны.

## 4. Backend artifact identity

`Backend image integrity` строит exact-commit image, проверяет OCI revision, API/worker health, сканирует Trivy, а на `main` публикует immutable SHA-tagged image с BuildKit SBOM/provenance и keyless Sigstore signature.

Production readiness требует **конкретный registry digest**, а не только tag. Пока exact digest не приложен к evidence snapshot, состояние остаётся `UNVERIFIED_CURRENT_DIGEST` и production artifact нельзя считать подтверждённым.

После этого изменения main-публикация также сохраняет `backend-image-identity` artifact с `git_sha`, immutable tag и digest; readiness workflow умеет подхватить эту identity после завершения image workflow.

## 5. Environment truth

| Environment | Статус | Что доказано |
|---|---|---|
| Isolated CI staging | `PASSED` | PostgreSQL/Redis/Bearer-auth/runtime topology на exact candidate |
| External production-like staging | `UNVERIFIED` | Нет retained authoritative evidence реального deployed topology/load для текущего release candidate |
| Production | `UNVERIFIED` | Нет retained authoritative deployment SHA + image digest + runtime evidence |

Нельзя преобразовывать isolated staging CI в утверждение «staging/prod работает» без внешнего evidence.

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

## 8. Restore evidence

Последний repository restore drill, сохранённый в readiness evidence:

- workflow run `32640629706`;
- exact head `6b583f596b7dd004273ba08044bbb0dc82a85d6e`;
- `SUCCESS`;
- PostgreSQL logical backup → isolated restore → schema verification → deterministic data fingerprint;
- это synthetic/repository drill, **не доказательство восстановления production backup**.

Production backup restore остаётся `NOT_EXTERNALLY_VERIFIED` до отдельного operator evidence.

## 9. Release identity

Source mobile identity сейчас: version `0.3.7`, iOS build `3`, Android versionCode `3`.

`EAS Build & Submit` умеет выпускать и сохранять exact release identity (`git_sha`, app version, profile, platform build IDs). Пока такой retained artifact/operator confirmation не привязан к readiness evidence, поле latest EAS release остаётся `NOT_EXTERNALLY_VERIFIED`.

Нельзя считать исходный `app.json` доказательством загрузки в TestFlight/App Store/Google Play.

## 10. Security risk and external acceptance

Repo controls реализованы через security-operations slice #258. OSV exception baseline пустой; CodeQL, Gitleaks и container/dependency gates обязательны в CI.

**Accepted security risks:** отсутствуют. Если residual risk будет принят, manifest требует минимум `id`, owner, expiry date и evidence. Запись без срока действия запрещена readiness validator.

Остаются внешние security blockers:

- #247 — **P0:** `main` branch protection / required production checks. Последняя GitHub metadata проверка всё ещё показывает `protected=false`;
- #256 — реальный GitHub/org privileged-access review;
- #257 — независимый pre-launch penetration/abuse test;
- #237 — общий external security acceptance, включая provider credential rotation/revocation drill.

## 11. Open launch blockers

Readiness manifest перечисляет launch-blocking issues и CI проверяет, что они действительно остаются `open`; если issue закрывается, manifest обязан быть пересмотрен.

- **P0 #247** — protect `main` and require production gates.
- **P1 #236** — real external staging capacity/provider-degradation evidence.
- **P1 #237** — external security acceptance.
- **P1 #238** — remaining e-sign authoritative-read and S3 ambiguous-write recovery.
- **P1 #241** — controlled production pilot, telemetry and launch operations.
- **P1 #256** — privileged repository/org access review.
- **P1 #257** — independent penetration/abuse test.

Пока существует любой P0/P1 launch blocker, readiness generator запрещает состояние `READY_FOR_BROAD_PRODUCTION`.

## 12. Обновление source of truth

При изменении migration head, mobile build/version, provider readiness, SLO/restore/release evidence или launch blockers нужно обновить `docs/production-readiness-evidence.json` в том же PR. `Production readiness integrity` проверяет consistency и сохраняет SHA-bound snapshot.

External/operator evidence считается подтверждённым только если в manifest есть конкретная retained evidence identity/URL/ID. Формулировки вида «настроено», «запущено», «проверено вручную» без доказательства не переводят статус в `VERIFIED`.
