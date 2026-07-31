# Dashboard read integrity — 2026-07-31

## Исправленная проблема

Старый `GET /api/v1/projects/{project_id}/dashboard` совмещал чтение панели с изменением состояния:

- для исполнителя присваивал отфильтрованный список в `project.stages`; у relationship включён `delete-orphan`, поэтому последующий commit мог удалить или отвязать скрытые этапы;
- при каждом открытии панели создавал новый `MarginSnapshot`, формируя дубли и неограниченный рост таблицы;
- выполнял commit внутри GET-запроса;
- скрывал ошибки enrichment и snapshot через `except Exception: pass`;
- завершённому проекту возвращал `next_action_type=review_estimate`;
- проект только с planned-этапами или без этапов ошибочно назывался завершённым;
- завершение личных работ исполнителя могло быть показано как завершение всего проекта.

## Финальная архитектура

1. В `projects.py` существует ровно один `GET /projects/{project_id}/dashboard`.
2. Отдельный `project_dashboard.py`, router-detach и runtime-подмена маршрута удалены. В репозитории нет второй, мёртвой или опасной реализации endpoint.
3. `dashboard_integrity_service.stages_for_user` возвращает новый role-scoped список и никогда не присваивает его ORM relationship.
4. Dashboard строится из detached read projection через `SimpleNamespace`, поэтому построение панели не может изменить объект SQLAlchemy.
5. Enrichment выполняется в отдельной сессии. Ошибка вторичного чтения не портит request session и явно возвращается как:
   - `degraded=true`;
   - `data_quality.actions=unavailable`;
   - пользовательский alert.
6. GET dashboard не создаёт `MarginSnapshot`, не вызывает `db.add` и не выполняет commit. Снимки маржи должны формироваться только отдельным write/event/scheduled-процессом.
7. Terminal action `completed` для всего проекта возвращается только когда существуют этапы и все project stages имеют статус `done`.
8. Состояния разделены:
   - planned-only — `Следующий этап: ...`;
   - пустой проект — `Добавьте этапы и смету`;
   - у исполнителя нет назначений — `Нет назначенных этапов`;
   - личные этапы выполнены, но проект продолжается — `Назначенные работы выполнены`;
   - весь проект выполнен — `Проект завершён`.

## Зафиксированные инварианты

`backend/tests/test_dashboard_read_integrity.py` блокирует регрессии:

- фильтрация исполнителя не изменяет исходную ORM-коллекцию;
- заказчик получает полный отсортированный список этапов;
- завершённый проект получает terminal action;
- planned-only и пустой проект не считаются завершёнными;
- завершение assignment не маскируется под global completion;
- отсутствие назначений не выдаётся за пустой проект;
- ошибка enrichment не скрывается;
- в собранном API существует ровно один dashboard-route из `app.api.v1.projects`;
- в исходниках существует ровно один dashboard decorator;
- dashboard-блок не содержит `db.add`, `db.commit`, `MarginSnapshot`, ORM-присваивания или silent exception;
- отдельный `project_dashboard.py` отсутствует;
- router не содержит runtime mutation или transitional detach.

Тест включён в обязательный backend CI рядом с финансовыми, OCR, FNS, NPD и PDF integrity checks.
