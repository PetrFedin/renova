Ты работаешь в репозитории Renova.

Сначала native entrypoint текущего клиента должен выбрать ровно один adapter под `.agent/platforms/` по **host application**: Claude Code, Cursor, Codex или ChatGPT/GPT. Не определяй клиент по названию **foundation model**: Claude внутри Cursor остаётся Cursor, GPT внутри Cursor остаётся Cursor. Если host application нельзя установить из native entrypoint, не угадывай его по модели.

После этого прочитай полностью, в этом порядке:
1. AGENTS.md
2. активный `.agent/platforms/<client>.md`
3. docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md
4. docs/technical-spec/GOLDEN-PATHS.md
5. docs/technical-spec/<контракт области задачи>

После обязательного чтения канона, если задача требует дополнительного task-specific guidance, прочитай `.agent/skills/renova-product-engineering/SKILL.md` и загрузи только релевантный дочерний Skill. `.agent/platforms/**` и `.agent/skills/**` не переопределяют `AGENTS.md`, текущий код/CI, governed contracts или Renova design system; не загружай всю библиотеку без необходимости.

Перед созданием новой задачи восстанови shared state из GitHub. Проверь current main, текущую branch, связанный issue, существующий pull request, commits, changed files, checks/reviews и последние evidence-комментарии. Если matching branch/PR уже существует, продолжай его независимо от того, в Claude, Cursor, Codex или ChatGPT выполнялась предыдущая часть. Чат-память не является источником состояния проекта. Если branch head изменился после чтения, перечитай diff/checks перед записью.

Возьми задачу <ID> из мандата §4 (issue с лейблами `agent-task` + `ready`, Mandate ID = <ID>). Поставь issue лейбл `in-progress`.

Перед любыми правками:
- `npm run dev -- doctor && npm run dev -- bootstrap && npm run dev -- check && npm run dev -- test-focused` — зафиксируй baseline (число passed);
- составь список всех файлов цепочки §1.3 (mobile → api client → router → service → model → outbox → worker → mobile) через grep и приведи его.

Правила, которые нельзя нарушать:
- ничего не удалять без раздела `Removal proof` с выводом grep и ссылкой на замену (§1.1); если доказательства нет — оставить и пометить `LEGACY-RETAINED`;
- число прошедших тестов не уменьшается;
- не расширять legacy writers, не добавлять workflow, не переводить провайдеры в real, не ослаблять staging/production policy;
- найденные вне задачи дефекты — issue, не молчаливый фикс.

Порядок: падающий тест → минимальная реализация → `npm run dev -- test-full` → ручная проверка цепочки (curl + mobile-web) → ветка `agent/<ID>-<slug>` → PR по шаблону `.github/pull_request_template.md`, все разделы заполнены, в Evidence строки `baseline: … → N passed` и `after: … → N passed`. В теле PR: `Refs #<issue>` (никогда `Closes #300`). Не мержить самостоятельно. Если находишь противоречие между мандатом, AGENTS.md и кодом — запиши его в §9 мандата и остановись с вопросом, а не решай сам.

Если работа останавливается для продолжения в другом клиенте, оставь в GitHub достаточно handoff-состояния: exact branch/head SHA, issue/PR, реально наблюдавшиеся checks, unresolved blocker и следующий bounded action.
