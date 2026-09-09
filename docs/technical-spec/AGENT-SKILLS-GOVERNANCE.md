# Renova — governance task-specific Agent Skills

**Статус:** candidate для issue #368, до merge не является частью `main`.  
**Базовый срез:** `e5c6ee44c0f684b14037e77948dbcb630fd41896`.  
**Назначение:** добавить небольшие task-specific инструкции для coding agents без второго engineering-policy, без копирования внешних skill-репозиториев целиком и без изменения product/runtime behavior.

## 1. Что является источником истины

`AGENTS.md` остаётся единственным authoritative engineering-policy и в этом change-set не редактируется. Discovery нового слоя подключается через bootstrap `.agent/kickoff.md`: после чтения канона агент может загрузить router и только нужный task-specific Skill. Skills под `.agent/skills/` — выборочные рабочие инструкции для конкретного типа задачи.

Порядок приоритета:

1. текущий код, миграции, CI/runtime/readiness evidence;
2. `AGENTS.md`;
3. текущий issue, Product Completion Mandate и применимый governed contract;
4. доменный source of truth, включая route registry, provider/finance contracts и Renova design system;
5. локальный task-specific Skill;
6. внешний upstream как advisory guidance.

Skill не может повысить уровень доказанности, изменить бизнес-семантику или отменить fail-closed границы более высокого уровня.

## 2. Первый пакет

| Skill | Назначение | Что намеренно не делает |
|---|---|---|
| `renova-product-engineering` | router: выбирает минимальный набор инструкций для текущей задачи | не дублирует `AGENTS.md`, не создаёт роль агента |
| `context-engineering` | отбор контекста, контроль дрейфа, handoff и long-horizon continuity | не определяет архитектуру продукта |
| `ui-ux-review` | UX/UI review после загрузки текущего design/navigation canon | не заменяет `.cursor/rules/renova-design-system.mdc` и `components/ui` |
| `writing-quality` | точная, человеческая редактура документации, PR и UI copy | не переписывает identifiers, enums, API/finance/legal semantics ради стиля |

По умолчанию загружается не библиотека целиком, а только router и реально нужный capability. Это уменьшает конфликт инструкций и context noise.

## 3. Upstream provenance

Полный внешний код не vendored. Принцип пакета — `distilled-not-vendored`: из внешних материалов перенесены только проверенные общие практики, адаптированные к Renova и подчинённые локальному канону.

Immutable версии и лицензии зафиксированы в `.agent/skills/UPSTREAM.lock.json`:

- `muratcankoylan/Agent-Skills-for-Context-Engineering` — commit `6dbe1a1d868eab51a3bc9011b0f55e2891513e40`, MIT;
- `nextlevelbuilder/ui-ux-pro-max-skill` — commit `4aad0584d92131626b16d4ff4d77f0455385013c`, MIT;
- `hardikpandya/stop-slop` — commit `8da1f030185bdfe8471220585162991eaeb970e9`, MIT.

Никакой `main`, `latest` или другой floating ref не является версией зависимости. Обновление upstream требует отдельного diff-review: новый SHA, повторная проверка лицензии, анализ изменений и подтверждение, что принятые Renova-правила действительно получают пользу.

## 4. Проверка конфликтов с текущим репозиторием

### Claude

Текущий `.claude/settings.json` запрещает agent writes в `.claude/**`; этот пакет туда не пишет. Открытый PR #364 добавляет специализированные role agents (`backend-dev`, `mobile-dev`, `test-runner`, `reviewer`). Этот пакет не создаёт их копии: Skills отвечают за task guidance, а role agents — за изоляцию роли/контекста и tool permissions.

### Cursor / UI

`.cursor/rules/renova-design-system.mdc` остаётся обязательным UI-каноном. `ui-ux-review` сначала требует прочитать этот файл, route registry, theme/tokens и актуальные UI primitives. Внешние UI/UX-паттерны классифицируются как advisory, если Renova canon не делает их обязательными.

### AGENTS.md / bootstrap

Skills не переносят в себя архитектурные, financial, security, migration, release или evidence правила из `AGENTS.md`. `AGENTS.md` не меняется; `.agent/kickoff.md` получает только discovery pointer после обязательного чтения канона. Это предотвращает две расходящиеся копии одного policy.

### Параллельные PR

На момент формирования пакета PR #366 меняет master specification и несколько файлов `docs/technical-spec/`, но не этот новый governance-файл и не `.agent/skills/`. Поэтому пакет не редактирует файлы из changed-file set PR #366. PR #364 меняет только `.claude/agents/**`; пакет не редактирует эту область.

## 5. Детерминированная валидация

Запуск из корня репозитория:

```bash
python scripts/validate_agent_skills.py --root .
```

Validator использует только Python stdlib и проверяет:

- точный набор entrypoints первого пакета;
- `SKILL.md` frontmatter только с `name` и `description`;
- совпадение имени Skill с каталогом и уникальность имён;
- наличие всеч router references;
- валидность `UPSTREAM.lock.json`;
- 40-символьные immutable commit SHA, MIT license и отсутствие floating selectors;
- связь upstream → локальный capability;
- наличие обязательной governance-документации.

Validation script не является доказательством product runtime. Он подтверждает только структурную целостность Agent Skills слоя.

## 6. Evidence boundary

Этот change-set не меняет backend, mobile product behavior, DB schema, migrations, provider modes или runtime policy. Поэтому он не может сам по себе создавать `STAGING VERIFIED`, `EXTERNALLY VERIFIED`, `PRODUCTION VERIFIED` или новый product-readiness claim.

До merge требуется применимый GitHub CI для exact candidate, независимый review и отсутствие конфликтов с актуальным `main`. Автор change-set не выполняет self-merge.

## 7. Что сознательно не включено

- Marketing skills: нет текущего bounded product-engineering use case в issue #368.
- Remotion/video skills: нет текущей задачи на генерацию product video.
- Полные upstream repositories, dataset/search scripts и plugin-specific scaffolding: не нужны для текущего Renova workflow и увеличили бы context/supply-chain поверхность.
- Изменения `.claude/**`, `.cursor/rules/**`, `.github/workflows/**`: не требуются для полезности первого пакета и создавали бы лишние конфликты/границы доступа.

Добавлять следующий capability следует только от конкретного повторяющегося Renova-процесса, где можно указать ожидаемую пользу и критерий приёмки.
