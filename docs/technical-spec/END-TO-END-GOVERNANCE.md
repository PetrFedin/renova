# Renova — mandatory end-to-end specification governance

**Status:** ACTIVE / AUTHORITATIVE ANNEX  
**Parent dossier:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`  
**Operational board:** `docs/technical-spec/PRODUCT-COMPLETION-BOARD.md`  
**Effective from:** 2026-08-29  
**Current reconciliation:** 2026-09-16

Это обязательное governance ТЗ, а не рекомендация. Его задача — не дать коду, плану и фактической доказанности разойтись.

---

## 1. Same-change specification rule

Любое изменение behavior, architecture, data, API, migration, runtime, background work, security/ACL, UX, calculation, provider, recovery, CI/release gate или evidence обязано в той же logical change:

1. обновить соответствующий domain/spec annex;
2. обновить Completion Board, если меняется статус M/GP/F/Wave;
3. обновить roadmap, если меняется dependency/order;
4. либо явно написать `Board/Roadmap status unchanged` и почему.

Green code + stale specification = incomplete change.

---

## 2. Mandatory pre-task reconciliation

До правки кода/ТЗ агент обязан получить текущую реальность:

1. canonical `main` SHA;
2. Alembic head;
3. open P0/P1 issues;
4. open/draft/stacked PR, exact heads, bases и dependencies;
5. last applicable CI runs;
6. deployed/browser/native evidence, если затрагивается user surface;
7. production readiness;
8. Completion Board;
9. master spec + roadmap;
10. affected contracts/calculation/screen catalogs.

Нельзя продолжать сохранённый старый план по памяти, если репозиторий уже изменился.

### 2.1. Evidence freshness

- Evidence принадлежит exact SHA.
- Rebase/change/merge создаёт новый qualification obligation.
- Stale old-base green не переносится на новый candidate.
- Если старый документ оптимистичнее нового runtime evidence — статус понижается немедленно.
- Если новый P0 выше текущей задачи по risk — порядок пересчитывается.

---

## 3. Mandatory gap scan

Перед реализацией пройти всю affected chain:

`entry/navigation → authorization → input/schema → service → transaction → authoritative DB → outbox/provider/storage → reconciliation → API read → second side → UI/file → retry/recovery/reversal → audit/history`.

Искать:

- dead ends;
- broken entity/event/screen links;
- duplicate writers/routes/calculations;
- stale legacy path;
- missing transaction/idempotency/version fence;
- missing lock-time authority recheck;
- response-loss ambiguity;
- split commit;
- loading/empty/error/stale/conflict/offline confusion;
- session/account/project leakage;
- child-resource IDOR;
- schema/ORM drift;
- plan/fact/zero/unknown substitution;
- provider simulation passed as live;
- missing cancel/reversal/restore;
- hidden action discoverability;
- documentation that describes obsolete behavior.

Confirmed P0/P1 создаёт issue/board row с acceptance/evidence boundary. Он не остаётся только в чате.

---

## 4. Unit of acceptance

Единица приёмки — полный business result.

Где применимо:

`create → authoritative read → counterpart visibility → update/transition → linked calculation → error/ACL → offline → commit+lost-response → retry → conflict → reversal → restore/reconcile → account switch → terminal history`.

Изолированный endpoint/кнопка/unit-test не завершает chain.

---

## 5. Canonical authority hierarchy

- Engineering policy: `AGENTS.md`.
- Product/system contract: master spec.
- Current factual execution order: Completion Board.
- Task acceptance catalogue: Product Completion Mandate.
- Golden Paths: `GOLDEN-PATHS.md`.
- Navigation: route registry + actual routes.
- API: final router composition + canonical service.
- Data: ORM + linear Alembic + PostgreSQL.
- Money: explicit ledger/source-of-fact rules.
- Background: DomainOutbox + worker.
- Readiness: root readiness Markdown/JSON.

При конфликте static task order и нового confirmed risk, **acceptance mandate сохраняется, execution order пересчитывается по Board**.

---

## 6. Priority resolver

Использовать только этот порядок риска:

1. Security / cross-project/account isolation / money corruption.
2. Atomicity / exactly-once / response-loss / reversal.
3. Session / offline / cache provenance.
4. Calculation / reconciliation truth.
5. Browser/native navigation/accessibility correctness.
6. Lifecycle/multi-party closure.
7. Human usability/friction/terminology.
8. External production readiness.
9. New capability.

### 6.1. Dependency-aware choice

Если самая высокая задача заблокирована owner merge/external admin action:

- blocker не обходится;
- выбирается независимая задача того же или более высокого класса риска;
- нельзя перескочить к новой feature только потому, что P0 ждёт review.

---

## 7. Merge gate

До merge обязательно проверить:

- one authority per concept;
- exact current base/head;
- same-change spec;
- no hidden confirmed gaps;
- applicable negative/replay/concurrency tests;
- no test deletion/expected-value rewrite without proven contract change;
- no stale candidate evidence;
- no provider-mode truth weakening;
- no main-protection bypass;
- removal proof where required;
- no unrelated scope expansion.

### 7.1. Stacked candidate rule

Stacked PR может быть `CANDIDATE PROVEN` только для bounded primitive на exact qualification context. После prerequisite merge он обязан:

1. rebase/refresh onto resulting main;
2. rerun applicable exact-head checks;
3. resolve conflicts without reverting newer security/data contracts;
4. only then become merge-eligible.

Raw stacked aggregate test counts не называются comparable integrated evidence, если bases различаются.

### 7.2. Draft-transition/tooling failure

Tooling failure не разрешает push main. При невозможности перевести qualified Draft в Ready:

- зафиксировать blocker;
- не self-merge;
- при необходимости создать bounded successor from qualified lineage;
- получить fresh exact-head evidence;
- old draft пометить superseded после безопасной замены.

---

## 8. Post-merge reconciliation

После каждого merge:

1. получить новый `main` SHA/head;
2. проверить migration/readiness agreement;
3. повысить только реально интегрированные bounded cells;
4. rebase/requalify descendants;
5. пересчитать next Wave task;
6. закрыть issue только если полный acceptance issue выполнен;
7. обновить review/deployed evidence, если merge затрагивает стенд.

Foundation merge никогда автоматически не закрывает parent cross-domain problem.

---

## 9. Current integration order

Подробности и номера — Completion Board / roadmap.

Текущий порядок:

1. trusted integration foundation (#425 → #389/#372/#437/#450 + #247 live settings);
2. security/data authority (#444/#424/#452/#441, #455→#456, finance facts);
3. replay/atomicity (#322 prerequisite → remaining #316 tree → #461);
4. session/offline/cache (#315/#317);
5. connected GP1;
6. multi-contractor + GP2/GP3;
7. purge/native/closeout/warranty/provider simulated closure;
8. Human Usability Closure;
9. one-SHA GP1–GP8 internal acceptance;
10. external production qualification.

Эта последовательность меняется только при новом evidence/prerequisite, а не по желанию сделать более заметную функцию.

---

## 10. Deployed/user-surface evidence rule

Если существует public/review stand, source/CI не заменяет browser behavior.

Для current review на 2026-09-16 известен красный full product smoke: Chromium 4/10, WebKit failed. Поэтому UI/navigation/accessibility нельзя считать завершёнными только по green API/runtime tests.

Каждый deployed finding классифицируется:

- PRODUCT_DEFECT;
- TEST_INFRA_DEFECT;
- STALE_CONTRACT — только с доказательством изменения продуктового контракта;
- EXTERNAL/ENVIRONMENT blocker.

Нельзя переписывать assertion под текущее отображаемое значение без доказательства STALE_CONTRACT.

---

## 11. Calculation truth governance

Для любого derived KPI:

- exact inputs;
- grain;
- missing/null semantics;
- zero semantics;
- units/currency;
- timezone/as-of;
- rounding/conservation;
- reversal/refund;
- source drill-down;
- tests.

Unknown ≠ zero. Plan ≠ actual. Invoice ≠ payment. Approved ≠ ordered.

CALCULATION-REGISTRY и affected UI/API обязаны меняться совместно.

---

## 12. UX governance

UX не может скрывать integrity defect. После P0 foundation Human Usability Closure должен уменьшать трение, но не создавать вторую business truth.

Основные принципы:

- task-oriented UI;
- one primary action;
- stable navigation;
- explicit actor/next action;
- consequence before approval;
- chat as context, not source of truth;
- Inbox as attention queue;
- progressive disclosure;
- truthful loading/error/stale/offline/conflict;
- accessibility as correctness.

---

## 13. Provider/external evidence

Simulator может закрывать внутренний GP только если это прямо предусмотрено mandate/GOLDEN-PATHS. Он не является production provider evidence.

Real provider, managed DR, external alert delivery, load, pentest, legal/privacy и pilot сохраняют `FUTURE EXTERNAL` до фактического внешнего доказательства.

---

## 14. Documentation Definition of Done

Документация считается синхронизированной, если:

- master header отражает real canonical schema;
- Board отражает current main/candidate evidence;
- roadmap отражает dependency order;
- domain contract отражает changed behavior;
- PR body имеет truthful baseline/after/evidence boundary;
- readiness не завышена;
- historical snapshots не используются как current truth.

Нельзя писать «готово», если реально только source exists; нельзя писать «не реализовано», если доказано, что функция существует, но не квалифицирована. Правильный статус в последнем случае — `PARTIAL`.

---

## 15. Final acceptance governance

PRODUCT COMPLETE claim допустим только по одному immutable SHA и одному evidence pack. После изменения SHA affected evidence переисполняется.

Обязательны:

- GP1–GP8;
- M01–M12 dispositions;
- mutation/recovery inventory;
- role/ACL negatives;
- calculation reconciliation;
- browser/native acceptance;
- migration/restore;
- closeout/warranty/history;
- explicit external limitations.

Отдельное мнение автора/агента не является release verdict.
