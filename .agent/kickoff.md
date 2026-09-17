Ты работаешь в репозитории Renova. Перед любой новой задачей прочитай полностью, в этом порядке:

1. `AGENTS.md`
2. `docs/technical-spec/PRODUCT-COMPLETION-BOARD.md`
3. `docs/RENOVA-TECHNICAL-SPECIFICATION.md`
4. `docs/technical-spec/CHANGELOG-ROADMAP.md`
5. `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md`
6. `docs/technical-spec/GOLDEN-PATHS.md`
7. `docs/technical-spec/<контракт области задачи>`

## 1. Сначала восстанови реальность, потом выбирай задачу

До любых правок получи и зафиксируй:

- текущий `main` SHA;
- текущий Alembic head;
- открытые P0/P1 issues;
- открытые/draft/stacked PR, их base/head SHA и prerequisites;
- последние применимые CI runs;
- deployed/review evidence, если затрагивается user surface;
- текущие `BLOCKED / PARTIAL / CANDIDATE PROVEN` строки Completion Board.

Не бери задачу только потому, что она раньше была первой в mandate/roadmap или имеет старый label `ready`. Приоритет пересчитывается по текущему evidence.

Priority resolver:

1. security / cross-project/account isolation / money corruption;
2. atomicity / response-loss / exactly-once / reversal;
3. session / offline / cache truth;
4. calculation / reconciliation truth;
5. browser/native navigation/accessibility blockers;
6. lifecycle / multi-party closure;
7. human usability/friction;
8. external readiness;
9. new features.

Если highest-priority task заблокирована owner merge/external action, выбери независимую задачу того же или более высокого класса риска. Не обходи prerequisite и не перескакивай к новой feature.

## 2. Mandate остаётся acceptance catalogue

Задачи A1–E4 и их acceptance из `PRODUCT-COMPLETION-MANDATE.md` не удаляются и не ослабляются. Но **текущий порядок выполнения определяет Completion Board**, потому что он учитывает новый P0, stacked dependencies и exact-head evidence.

Для существующего mandate issue используй его ID/labels и не создавай дубль. Для hotfix/security/recovery child используй существующий issue/PR graph.

## 3. Перед реализацией

Зафиксируй baseline применимых проверок. Для локально доступного canonical runtime используй policy из `AGENTS.md`; если конкретная среда недоступна, не выдумывай local success — используй exact CI/runtime evidence и явно укажи boundary.

Составь полную цепочку affected behavior:

`mobile/UI → API client → router → service → model/transaction → outbox/storage/provider → worker → authoritative read → counterpart UI → retry/reversal/history`.

Проверь:

- ACL/object binding;
- transaction/commit boundary;
- client intent/version fence;
- offline/response-loss behavior;
- second-side visibility;
- linked calculations;
- cancellation/reversal;
- session/account/project switch;
- evidence/history.

## 4. Правила, которые нельзя нарушать

- ничего не удалять без `Removal proof`; если доказательства нет — оставить и пометить `LEGACY-RETAINED`;
- не ослаблять tests/gates ради green;
- не переписывать assertion под текущее отображаемое значение без доказанного `STALE_CONTRACT`;
- не расширять legacy writers;
- не переводить provider в `real` без отдельного approved scope/evidence;
- не называть candidate на stale base интегрированным;
- не называть source presence E2E proof;
- найденный вне scope дефект → issue/Board update, не молчаливый scope creep;
- no self-merge.

## 5. После реализации

1. Пройди exact applicable tests/CI.
2. Сверь persisted DB/storage/read-model outcomes.
3. Обнови affected domain spec.
4. Обнови `PRODUCT-COMPLETION-BOARD.md`, если изменился status/evidence/order.
5. Обнови `CHANGELOG-ROADMAP.md`, если изменился dependency/order.
6. PR обязан содержать truthful `baseline`, `after`, exact SHA/run и evidence boundary.
7. Green open PR = максимум `CANDIDATE PROVEN` для доказанного bounded contour.
8. После owner merge descendants обязаны rebase/requalify; старый green не переносится автоматически.

## 6. Критерий хорошего следующего шага

Следующая работа должна уменьшать количество `BLOCKED/PARTIAL` клеток полного lifecycle, а не просто увеличивать число экранов, файлов, endpoints или настроек.

Если после сверки фактический приоритет отличается от записанного вчера, обнови план и следуй новому evidence-driven порядку. Не защищай устаревшую очередь только потому, что она уже была записана.
