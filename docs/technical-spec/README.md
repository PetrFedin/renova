# Renova technical dossier — индекс

Этот каталог является **приложениями** к главному системному документу `docs/RENOVA-TECHNICAL-SPECIFICATION.md`.

## Иерархия источников

1. `AGENTS.md` — единственный authoritative engineering-policy для Cursor / Claude Code / coding agents.
2. `docs/RENOVA-TECHNICAL-SPECIFICATION.md` — главный living product/system dossier: что существует, как связано, как должно вести себя и чем подтверждается.
3. Файлы этого каталога — детальные проверяемые приложения к главному dossier; они не имеют права вводить альтернативную архитектуру.
4. Конкретный implementation source + Alembic + tests остаются последней проверяемой фактической основой. Если приложение расходится с кодом, это documentation defect и CI должен потребовать обновление.

## Текущие приложения

### `CHANGELOG-ROADMAP.md`

Управляемый журнал развития проекта:

- каждое существенное изменение как `наблюдение → решение → source → test → evidence → next step`;
- история обнаруженных runtime/schema/UI/data defects;
- exact SHA/evidence status без переноса green результатов между кандидатами;
- приоритизированный P0/P1/P2 roadmap;
- Definition of Done и residual risk по каждому активному направлению;
- обязательная фиксация дальнейших изменений до/вместе с реализацией.

### `CALCULATION-REGISTRY.md`

Реестр подтверждённых формул и derived metrics:

- budget plan/fact;
- source hydration Expense;
- BudgetLine projection;
- UI ↔ server reconcile;
- budget summary state;
- project progress;
- schedule execution stats;
- period budget aggregation;
- portfolio aggregation;
- procurement/selection attention counts;
- явные caveats и backlog непокрытых formulas.

### `SCREEN-CONTRACT-CATALOG.md`

Экранные контракты:

- role-aware shared-screen architecture;
- exact shared geometry/touch/button rules;
- Object / Repair / Budget hubs;
- Materials / procurement;
- Selections;
- Customer / Contractor / Technical Supervision Control;
- filters, badges, actions, state transitions, cross-links;
- consistency debt и обязательный backlog remaining screens.

### `SCREEN-SOURCE-SNAPSHOT.md`

Machine-readable source snapshot экранов и shared UI sources, используемый drift contract.

## Drift protection

Workflow: `.github/workflows/technical-spec-integrity.yml`.

Contracts:

- `scripts/technicalSpecContract.test.mjs` — master dossier ↔ routes/design/core source blob snapshots;
- `scripts/technicalSpecAlembicContract.test.mjs` — ровно один Alembic head и его наличие в master dossier;
- `scripts/technicalSpecAnnexContract.test.mjs` — calculation/screen annexes ↔ implementation blob snapshots + semantic tokens.

Изменение tracked source без соответствующего обновления документации должно делать этот workflow красным.

## Обязательный рабочий цикл развития

Каждый следующий проход проекта выполняется так:

```text
прочитать master dossier + CHANGELOG-ROADMAP
→ сверить current code/CI/evidence
→ выбрать верхний незакрытый P0/P1
→ изменить implementation
→ изменить ТЗ/annex в том же контуре
→ добавить/усилить automated proof
→ получить exact-head CI
→ записать итоговый evidence/status
→ только затем переходить к следующему пункту
```

Запрещено наращивать backlog новыми идеями, пока существует доказанный P0 correctness/runtime/data-loss blocker выше по приоритету.

## Правило расширения

Новый annex допустим только если:

- он закрывает детальную область, которая перегружает основной dossier;
- основной architecture/ownership не дублируется противоречиво;
- у annex есть traceable implementation sources;
- для быстро меняющейся информации есть drift contract либо явно указано `TBD / UNVERIFIED`;
- доказанность `CI/STAGING/PRODUCTION VERIFIED` не повышается без реального evidence.
