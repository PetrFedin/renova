# Renova — governance task-specific Agent Skills and client routing

**Статус:** candidate для issue #368, до merge не является частью `main`.  
**Базовый срез:** `e5c6ee44c0f684b14037e77948dbcb630fd41896`.  
**Назначение:** дать Claude Code, Cursor, Codex и ChatGPT/GPT единый управляемый слой task-specific инструкций и бесшовное продолжение одной GitHub-задачи между клиентами без второго engineering-policy и без изменения product/runtime behavior.

## 1. Источник истины и порядок приоритета

`AGENTS.md` остаётся единственным authoritative engineering-policy. Native client entrypoints и `.agent/platforms/**` — только bootstrap/adapters; `.agent/skills/**` — bounded task guidance.

Порядок приоритета:

1. текущий код, миграции, CI/runtime/readiness evidence;
2. `AGENTS.md`;
3. текущий issue, Product Completion Mandate и применимый governed contract;
4. доменный source of truth, включая route registry, provider/finance contracts и Renova design system;
5. ровно один активный platform adapter;
6. минимально нужный local task Skill;
7. внешний upstream как advisory guidance.

Ни adapter, ни Skill не может повысить уровень доказанности, изменить бизнес-семантику или отменить fail-closed границы более высокого уровня.

## 2. Автоматический client routing

Маршрутизация определяется по **host application**, а не по foundation model:

| Host | Native entrypoint | Adapter |
|---|---|---|
| Claude Code | `CLAUDE.md` | `.agent/platforms/claude.md` |
| Cursor | `.cursor/rules/renova-agent-runtime.mdc` (`alwaysApply`) | `.agent/platforms/cursor.md` |
| Codex | `AGENTS.md` | `.agent/platforms/codex.md` |
| ChatGPT/GPT | установленный ChatGPT Skill `renova-product-engineering` | `.agent/platforms/gpt.md` |

Активируется ровно один adapter. Если Cursor использует Claude или GPT как foundation model, host остаётся Cursor. Нельзя переключать adapters по названию модели внутри одного клиента.

Все adapters сходятся к `.agent/kickoff.md`, затем к `.agent/skills/renova-product-engineering/SKILL.md`, а router загружает только реально нужный capability.

## 3. Cross-client resume protocol

Состояние проекта не хранится в памяти конкретного чата. При старте или продолжении работы клиент восстанавливает shared state из GitHub: current `main` → active branch → issue → PR → commits/diff → checks/reviews → retained evidence. Если matching branch/PR уже существует, новый клиент продолжает его, а не создаёт дубликат.

Перед записью нужно обновить branch head. Если другой клиент продвинул ветку после первоначального чтения, текущий клиент перечитывает diff/checks и только затем продолжает. При паузе для передачи работы в другой клиент GitHub должен содержать достаточный handoff: exact head SHA, issue/PR, реально наблюдавшиеся checks, unresolved blocker и следующий bounded action.

## 4. Первый пакет Skills

| Skill | Назначение | Что намеренно не делает |
|---|---|---|
| `renova-product-engineering` | router: client adapter → минимальный набор инструкций | не дублирует `AGENTS.md`, не создаёт роль агента |
| `context-engineering` | отбор контекста, контроль дрейфа, handoff и long-horizon continuity | не определяет архитектуру продукта |
| `ui-ux-review` | UX/UI review после загрузки design/navigation canon | не заменяет `.cursor/rules/renova-design-system.mdc` и `components/ui` |
| `writing-quality` | точная, человеческая редактура документации, PR и UI copy | не переписывает identifiers, enums, API/finance/legal semantics ради стиля |

По умолчанию загружается не библиотека целиком, а только active adapter, router и реально нужный capability.

## 5. Upstream provenance

Полный внешний код не vendored. Принцип пакета — `distilled-not-vendored`. Immutable версии и лицензии зафиксированы в `.agent/skills/UPSTREAM.lock.json`:

- `muratcankoylan/Agent-Skills-for-Context-Engineering` — commit `6dbe1a1d868eab51a3bc9011b0f55e2891513e40`, MIT;
- `nextlevelbuilder/ui-ux-pro-max-skill` — commit `4aad0584d92131626b16d4ff4d77f0455385013c`, MIT;
- `hardikpandya/stop-slop` — commit `8da1f030185bdfe8471220585162991eaeb970e9`, MIT.

Никакой `main`, `latest` или другой floating ref не является версией зависимости. Обновление upstream требует отдельного diff-review, повторной проверки лицензии и подтверждения пользы для Renova.

## 6. Конфликты с клиентами и параллельными PR

### Claude Code

Root `CLAUDE.md` остаётся bootstrap pointer. `.claude/settings.json` и `.claude/**` этим change-set не меняются. PR #364 со специализированными Claude role agents остаётся отдельным слоем: platform adapter и task Skills не копируют role agents и не считают незамерженный PR каноном.

### Cursor

Существующий `.cursor/rules/renova-agent-runtime.mdc` остаётся bootstrap-only, но теперь маршрутизирует в Cursor adapter. `.cursor/rules/renova-design-system.mdc` остаётся обязательным UI-каноном и имеет приоритет над generic UI guidance.

### Codex

`AGENTS.md` — native repository entrypoint. В нём допускается только короткий routing pointer к Codex adapter; архитектурная, security, financial и release policy не копируется в adapter.

### ChatGPT/GPT

ChatGPT Skill определяет Renova-задачу и использует connected GitHub truth. Repo adapter `.agent/platforms/gpt.md` задаёт только client-specific resume/evidence behavior; conversation memory не является источником состояния проекта.

### Параллельные PR

PR #366 меняет master specification, но не client-routing файлы этого change-set. PR #364 меняет Claude role-agent область; этот change-set не редактирует `.claude/**`.

## 7. Детерминированная валидация и evidence boundary

`python scripts/validate_agent_skills.py --root .` проверяет skill frontmatter/uniqueness/router references, immutable upstream lock, четыре platform adapters, native bootstrap links, host-application routing и GitHub-backed resume protocol. Validator подтверждает только структурную целостность agent layer, а не product runtime.

Change-set не меняет backend, mobile product behavior, DB schema, migrations, provider modes или runtime policy. Он не создаёт `STAGING VERIFIED`, `EXTERNALLY VERIFIED`, `PRODUCTION VERIFIED` или новый product-readiness claim. До merge требуется применимый GitHub CI exact candidate, независимый review и отсутствие конфликтов с актуальным `main`. Автор change-set не выполняет self-merge.

## 8. Что сознательно не включено

- Marketing skills: нет текущего bounded product-engineering use case.
- Remotion/video skills: нет текущей задачи на генерацию product video.
- Полные upstream repositories и plugin-specific scaffolding: не нужны и увеличили бы context/supply-chain поверхность.
- Новые GitHub workflows: не требуются для client routing.

Следующий capability добавляется только от конкретного повторяющегося Renova-процесса с ожидаемой пользой и критерием приёмки.
