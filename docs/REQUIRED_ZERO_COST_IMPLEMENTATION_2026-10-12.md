# renova — обязательная программа внедрения с нулевой стоимостью

**Snapshot:** 2026-10-12 · **Status:** REQUIRED / NOT ALL IMPLEMENTED · **Purpose:** persistent work pickup, not release evidence.

**Источник канона:** `AGENTS.md`, `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md`, `docs/technical-spec/GOLDEN-PATHS.md`, `PRODUCTION-READINESS.md`

**Текущее ограничение:** PR #683 открыт и требует независимого security review; PR #706 остаётся Draft. В Renova задачи передаются агенту через Issues с `agent-task` + `ready`; слияние только владельцем после второго ревью.

## Работы в порядке зависимости

| ID | Priority | Обязательно внедрить | Связи/зависимости | Доказательство завершения |
|---|---|---|---|---|
| REN-ZC-01 | P0 | Закрыть GP4/CI на точном SHA PR #706 | PR #706 → Golden Paths → backend/mobile → negative RBAC tests | все обязательные checks GREEN на exact SHA, воспроизводимые логи и проверка независимого reviewer |
| REN-ZC-02 | P0 | Завершить независимое review PR #683 без ослабления security gates | PR #683 → branch protection → security/history scan → release authority | есть второе ревью, доказанны права/отсутствие утечки данных разных tenants; merge делает только владелец |
| REN-ZC-03 | P0 | Перепроверить Verified Execution и Action Queue | execution events → acceptance evidence → financial authority → audit trail | API/mobile Golden Paths, идемпотентность и восстановление без потерь/двойных оплат |
| REN-ZC-04 | P1 | Завершить операционный UX и recovery | mobile client/contractor → tasks → media → receipt/notifications → persistence | device screenshots + browser/real device E2E, restart/offline/duplicate/retry cases |

## Непереговорные ограничения: 0 ₽ новых расходов
- Запрещено создавать/включать платные ресурсы, pay-as-you-go, автоапгрейд, платный AI/API, платную БД, облачное хранилище, CI minutes сверх бесплатной квоты или оплачиваемые production-транзакции.
- Сначала доказывать, что существующая локальная инфраструктура, open-source инструменты или **подтверждённый доступный** бесплатный лимит действительно не требуют оплаты. Если 0-cost ресурс не подтверждён — статус `BLOCKED_NO_FREE_CAPACITY`, не выдумывать альтернативную готовность.
- Не менять и не подключать базу, секреты, деплой другого продукта; никогда не публиковать DSN/токены. Никаких несанкционированных изменений production/main. Кодовые задачи — отдельные PR и существующие quality gates.
- Не запускать реальные платежи/торговлю/рассылки/платные провайдеры ради теста: тесты, моки, sandbox без биллинга или проверенная бесплатная среда.

## Правило для исполнителя / агента
1. Сверить **текущие** main/PR/issues/CI с источниками выше: статусы здесь — snapshot на 2026-10-12, не подтверждение release.
2. Работать по очереди P0 → P1 → P2, но сначала разблокировать зависимости; не начинать следующую бизнес-цепочку, если предыдущая не доказана.
3. Для каждого пункта в PR приложить: exact SHA, файлы, миграции/API/UI связи, локальные тесты, негативные проверки прав, browser/device screenshots (если UI), DB/backup proof (если persistence), live verification (если публичный сервис), стоимость **0 ₽** с источником/лимитом.
4. Отмечать отдельно `PLANNED`, `IN_CODE`, `CI_PASS`, `LIVE_VERIFIED`, `BLOCKED`. Никогда не отмечать `DONE` только из-за документации или зелёного unit-test.
5. Сверить с существующими canonical specs/AGENTS.md; этот чеклист добавляет приоритеты и cost gate, но не заменяет доменную архитектуру/политику.

## Передача следующему проходу
- Выбирай **первый незакрытый незаблокированный** пункт P0, проверяй реальное состояние и открывай точечную реализацию, а не создавай ещё один «план без кода».
- После каждого рабочего прохода обновляй issue/PR и данный чеклист с ссылками на evidence, но не перезаписывай наблюдения устаревшим snapshot.
