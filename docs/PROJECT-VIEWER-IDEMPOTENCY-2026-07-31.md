# Project viewer idempotency — 2026-07-31

## Исправленная проблема

`POST /api/v1/projects/{project_id}/viewers` выполнял последовательность check-then-insert:

1. искал существующий `ProjectViewer`;
2. при отсутствии создавал строку;
3. выполнял commit.

В таблице действует unique constraint `uq_project_viewer(project_id, user_id)`. Два параллельных запроса могли одновременно пройти предварительную проверку, после чего один запрос завершался `IntegrityError` и HTTP 500 вместо идемпотентного результата.

Дополнительно endpoint:

- мог создавать гостевую строку для владельца, назначенного исполнителя или прораба, у которых уже есть доступ;
- повторно загружал проект после `require_project` в list endpoint;
- содержал production-сообщение с упоминанием demo-входа;
- держал insert/commit непосредственно в API-слое.

## Новая архитектура

`project_viewer_service.grant_project_viewer` является единственной операцией создания viewer-доступа:

- обычный повтор возвращает существующую строку и `created=false`;
- insert выполняется внутри nested transaction/savepoint;
- конкурентный `IntegrityError` откатывает только savepoint;
- после коллизии сервис перечитывает строку-победитель и возвращает идемпотентный успех;
- неожиданный integrity failure без существующей canonical строки не скрывается;
- commit выполняется только для реально созданной записи.

`has_intrinsic_project_access` предотвращает создание гостевой записи для владельца, назначенного исполнителя и прораба.

## Инварианты CI

`backend/tests/test_project_viewer_idempotency.py` проверяет:

- два последовательных запроса создают ровно одну строку;
- unique race возвращает строку-победитель без commit и без повреждения основной транзакции;
- intrinsic project roles не дублируются в `project_viewers`;
- endpoint использует атомарный сервис и не содержит прямого insert/commit;
- list endpoint не выполняет повторный `get_project`;
- production copy больше не содержит demo-сценария.
