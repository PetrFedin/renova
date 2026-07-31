# Dashboard read integrity — 2026-07-31

## Исправленная проблема

Старый `GET /api/v1/projects/{project_id}/dashboard` совмещал чтение панели с изменением состояния:

- для исполнителя присваивал отфильтрованный список в `project.stages`; у relationship включён `delete-orphan`, поэтому последующий commit мог удалить или отвязать скрытые этапы;
- при каждом открытии панели создавал новый `MarginSnapshot`, формируя дубли и неограниченный рост таблицы;
- выполнял commit внутри GET-запроса;
- скрывал ошибки enrichment и snapshot через `except Exception: pass`;
- завершённому проекту возвращал `next_action_type=review_estimate`.

## Новая архитектура

1. `project_dashboard.py` является единственным runtime-маршрутом dashboard.
2. Legacy-маршрут удаляется из `projects.router` до регистрации. Замена fail-closed: приложение не стартует, если найдено не ровно одно legacy-описание.
3. `dashboard_integrity_service.stages_for_user` возвращает новый role-scoped список и никогда не присваивает его ORM relationship.
4. Dashboard строится из detached read projection через `SimpleNamespace`, поэтому построение панели не может изменить объект SQLAlchemy.
5. Enrichment выполняется в отдельной сессии. Ошибка вторичного чтения не портит request session и явно возвращается как:
   - `degraded=true`;
   - `data_quality.actions=unavailable`;
   - пользовательский alert.
6. GET dashboard больше не создаёт `MarginSnapshot` и не выполняет commit. Снимки маржи должны формироваться только отдельным write/event/scheduled-процессом.
7. Для завершённого проекта возвращается terminal action `completed`.

## Зафиксированные инварианты

`backend/tests/test_dashboard_read_integrity.py` блокирует регрессии:

- фильтрация исполнителя не изменяет исходную ORM-коллекцию;
- заказчик получает полный отсортированный список этапов;
- завершённый проект не предлагает действие по смете;
- ошибка enrichment не скрывается;
- в собранном API существует ровно один dashboard-route;
- endpoint не содержит `db.add`, `db.commit` или `MarginSnapshot`;
- canonical route регистрируется раньше общего projects router;
- замена legacy-route остаётся fail-closed.

Тест включён в обязательный backend CI рядом с финансовыми, OCR, FNS, NPD и PDF integrity checks.
