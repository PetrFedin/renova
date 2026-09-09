# RENOVA — mandatory end-to-end specification governance

**Status:** ACTIVE / AUTHORITATIVE ANNEX
**Parent dossier:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`
**Active work plan:** `PRODUCT-COMPLETION-MANDATE.md`
**Effective from:** 2026-08-29. **Current reconciliation:** 2026-09-09.

Это обязательное governance-правило, а не рекомендация. Оно действует для человека, агента, подрядчика и любого инструмента, меняющего RENOVA. Предыдущий полный срез сохранён в `history/END-TO-END-GOVERNANCE-before-2026-09-08.md` и является HISTORICAL.

## 1. Same-change specification rule

Любое изменение поведения, архитектуры, данных, API, миграций, runtime/background work, ACL/security, UX/navigation, calculations, providers, recovery, retention, CI/release gate или evidence обязано обновить living specification либо соответствующий governed annex в том же логическом изменении.

Green code + stale specification = **INCOMPLETE**.

Если меняются decision rights, financial semantics, state lifecycle или scope visibility, изменение обязательно отражается не только в техническом contract, но и в пользовательском сценарии/Golden Path.

## 2. Обязательный source-truth scan до проектирования

Перед изменением агент получает актуальные:

1. `main` SHA и open PRs, затрагивающие область;
2. `AGENTS.md`;
3. `PRODUCT-COMPLETION-MANDATE.md`;
4. `GOLDEN-PATHS.md`;
5. domain contract/calculation/screen contract;
6. реальные routes/router composition;
7. mobile callers/navigation;
8. models/migrations;
9. tests/CI/readiness;
10. связанные issues.

Нельзя проектировать по старому audit snapshot, если текущий code/CI свежее.

Mandatory gap scan:
- dead ends;
- broken entity/event/screen links;
- duplicate routes/calculations/state machines;
- stale mutating legacy paths;
- fields без producer/consumer;
- missing transaction/idempotency/concurrency;
- offline/response-loss ambiguity;
- missing loading/empty/error/stale/queued/conflict/revoked/recovery states;
- role/ACL/scope mismatch;
- schema/ORM drift;
- provider bypass;
- cache freshness laundering;
- financial source ambiguity;
- purge/retention omissions;
- file/native false success;
- user journey without terminal result;
- documentation describing obsolete behavior.

Confirmed P0/P1 gap фиксируется issue + owner + acceptance + evidence boundary. Он не остаётся только в chat/TODO.

## 3. Unit of design = complete user result

Любое изменение формулируется как:

`persona → context → intent → authority → input → canonical state transition → transaction → authoritative data → side effect/provider → reconciliation → read model → UI/file outcome → notification → retry/recovery → audit/evidence`.

Endpoint, model, button, background job или screenshot по отдельности не являются завершённой функцией.

Плановая capability не удаляется и не объявляется реализованной потому, что UI умеет показать «недоступно».

## 4. Обязательный lifecycle улучшения приложения

Любая просьба «улучшить», «добавить», «сделать как у аналога», «упростить», «переписать» проходит 12 шагов до merge:

1. **Source truth:** что реально уже есть.
2. **User problem:** кто и какой terminal result получает.
3. **Reuse map:** какой existing domain расширяется; почему не нужен parallel SoT.
4. **Lifecycle:** states/transitions/history.
5. **Decision rights:** кто создаёт, утверждает, отклоняет, отзывает, видит.
6. **Data/finance truth:** authoritative source, provenance/as-of/null/rounding/status semantics.
7. **Reliability:** transaction, stable intent, idempotency, race, offline, timeout, response loss, recovery.
8. **UX/navigation:** canonical entry, state matrix, deep links, native/file behavior, accessibility.
9. **Security/privacy/ecosystem:** scope/IDOR/consent/minimization/retention/provider boundary.
10. **Acceptance first:** Golden Path/domain test updated before implementation where behavior changes.
11. **Bounded implementation:** one authoritative writer, same-change spec, no unrelated refactor.
12. **Proof + reconciliation:** focused/PG/full/E2E/negative/recovery/native as applicable; then post-merge issue/readiness update.

Пропуск шага требует явного `N/A` с объяснением в PR evidence; молчаливый пропуск запрещён.

## 5. Market-inspired improvement governance

`MARKET-PRODUCT-BENCHMARK-2026-09-09.md` — research input, не очередь задач.

Функция аналога может войти в implementation только если доказаны:

- RENOVA user problem;
- связь с существующим product lifecycle;
- отсутствие duplicate SoT;
- Russian market relevance;
- failure/recovery model;
- concrete value;
- affected Golden Paths;
- owner priority decision.

Запрещено копировать enterprise modules, AI behavior, financing, marketplace mechanics или retailer workflows только для feature parity.

## 6. Canonical authorities

- Engineering: `AGENTS.md`.
- Product work order: `PRODUCT-COMPLETION-MANDATE.md`.
- User completion proof: `GOLDEN-PATHS.md`.
- Navigation: `routeRegistry` + final router composition.
- Durable data: PostgreSQL ORM + linear Alembic migrations.
- Money: explicit finance sources/recognition contracts.
- Background work: DomainOutbox + worker.
- External capability: provider ports/registry/adapters.
- Readiness: root `PRODUCTION-READINESS.md` + evidence JSON.
- Market ideas: benchmark annex only until adopted.

Historical snapshots are evidence of what was inspected, not current product authority.

## 7. No-demo-business rule

Controlled demo/test data may seed ordinary entities. Simulated providers may replace external services through the same port. Но запрещены:

- demo auth bypass in product flow;
- demo-only financial transition;
- fake successful provider status;
- seed-only route/action that user cannot execute;
- special calculations for showcase;
- synthetic project object published before server truth;
- UX that hides unavailable/recovery states only to look polished.

`demo:web`/presentation shell is allowed only as wrapper around ordinary product runtime.

## 8. Mutation truth and recovery

Critical mutation UI must distinguish:

`committed | queued | unknown_needs_reconcile | authoritative_refusal`.

After `committed`, refresh failure triggers read/reconcile recovery, never a new mutation identity. Automatic retry is prohibited until target server operation is replay-safe.

A→B→A is different session generation. Old async completion cannot publish into a new generation even if actor id matches again.

## 9. Financial governance

Before any budget/spend/payment change document:

- source entity;
- recognition timing;
- included/excluded statuses;
- original/revised/commitment/actual/cash distinction;
- refund/cancel/dispute treatment;
- currency/rounding;
- duplicate evidence/payment prevention;
- project/category/stage attribution;
- missing data semantics.

Presentation layer cannot repair missing facts by inventing fact=plan.

## 10. Provider/partner governance

До реального подключения ЮKassa/ФНС/Контур/Госключ/SMS/push/retail/bank:

- domain depends only on port;
- simulator passes same contract tests;
- provider operation has stable identity;
- webhook/retry/out-of-order semantics defined;
- unknown external result is reconciled, not guessed;
- secrets live server-side;
- health/readiness report mode truthfully;
- no UI claim of external verification without retained evidence.

Retail/bank/state-facing capabilities additionally require explicit data envelope, consent, minimization, audit and legal/privacy review before external activation.

## 11. Merge gate

Перед merge reviewer проверяет:

- same-change specification;
- complete affected chain;
- one authority per concept;
- decision rights;
- negative/replay/concurrency/recovery tests;
- relevant PostgreSQL integrity;
- mobile state truth;
- removal proof;
- provider boundary;
- exact candidate CI;
- current external-not-verified blockers;
- минимум одну независимую гипотезу «what else could break».

Автор не заменяет independent review своим повторным чтением. Merge выполняет owner/reviewer согласно `AGENTS.md`.

### 11.1. Draft/tooling recovery

Tooling failure не разрешает direct push to main. Если qualified Draft нельзя перевести Ready: зафиксировать blocker, создать bounded successor from qualified lineage, получить fresh exact-head qualification, merge only successor, старый Draft отметить superseded. Stale CI не переиспользуется как доказательство нового SHA.

## 12. Post-merge reconciliation

После merge:

1. issue закрывается только если полный acceptance satisfied on main;
2. readiness повышается только при новом evidence;
3. dependent PR rebase/requalify against canonical main;
4. foundation merge не закрывает cross-domain product issue;
5. old workflow result остаётся evidence только exact candidate;
6. market candidate не переводится в ready автоматически.

## 13. Current ordered product risk state

До provider/experience expansion первыми остаются integrity owners:

`#315 → remaining #316 → #317 → #305 truthful mutation UX → #318 → #319 → #320`, после чего полный `#300` и provider/product phases из Mandate.

PR #322 — bounded #316 candidate для chat invoice/task; не означает closure всего #316 до merge/full inventory.

External production work #233/#234/#235/#236/#237/#238/#241/#247/#256/#257 остаётся независимым и не должно блокировать внутреннюю архитектурную подготовку, но и не может быть объявлено выполненным internal CI.

## 14. Product-wide evidence model

Для каждого requirement сохраняется трассировка:

`requirement → persona/entry → state/service/entity → test → exact run/artifact → evidence level`.

Уровни различаются:

`SOURCE AUDITED → LOCAL TESTED → CI VERIFIED → STAGING VERIFIED → EXTERNALLY VERIFIED → PRODUCTION VERIFIED`.

Статический inventory экранов/маршрутов не является исполнением пользовательского сценария; web viewport не является native-device proof; simulated provider не является real-provider verification.
