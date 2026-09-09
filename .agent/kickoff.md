Ты работаешь в репозитории Renova. Прочитай полностью, в этом порядке:
1. AGENTS.md
2. docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md
3. docs/technical-spec/GOLDEN-PATHS.md
4. docs/technical-spec/<контракт области задачи>

После обязательного чтения канона, если задача требует дополнительного task-specific guidance, прочитай `.agent/skills/renova-product-engineering/SKILL.md` и загрузи только релевантный дочерний Skill. `.agent/skills/**` не переопределяет `AGENTS.md`, текущий код/CI, governed contracts или Renova design system; не загружай всю библиотеку без необходимости.

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
