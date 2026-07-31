# Unassigned project ACL isolation — 2026-07-31

## Исправленная уязвимость

В `team_service.project_access_mode` существовал fallback:

- пользователь имеет роль contractor;
- у проекта `contractor_id is None`;
- функция возвращает `("contractor", read_only)`.

Из-за этого любой contractor, знающий ID неназначенного проекта, мог получить доступ к данным проекта. При отсутствии membership значение `read_only` становилось `False`, поэтому уязвимость могла давать и write-доступ через все API, использующие `require_project(..., write=True)`.

Аналогичная логика в `team_role_for_project` могла возвращать роль из любой команды пользователя для неназначенного проекта и пропускать capability checks.

## Новая модель доступа

Contractor-доступ существует только в двух случаях:

1. `project.contractor_id == user.id` — пользователь является явно назначенным исполнителем;
2. пользователь состоит в команде, владелец которой равен `project.contractor_id`.

Для проекта без назначенного contractor:

- customer-владелец сохраняет полный доступ;
- explicit `ProjectViewer` сохраняет guest/read-only доступ;
- все contractor-пользователи получают `none`;
- принятие проекта выполняется только через отдельный `/projects/{id}/assign` transition, а не через неявный ACL fallback.

## Multi-team integrity

Старая реализация использовала `scalar_one_or_none()` для membership пользователя, хотя схема запрещает только дубликат внутри одной команды и разрешает участие в нескольких командах. Это могло приводить к `MultipleResultsFound`.

Теперь:

- `project_team_membership` выбирает membership только в командах назначенного contractor-owner;
- `team_owner_ids` возвращает полный набор владельцев всех команд пользователя;
- `my_team` и `my_membership` имеют детерминированный `.first()` вместо падения на нескольких memberships.

## Инварианты CI

`backend/tests/test_unassigned_project_acl.py` проверяет:

- неназначенный проект закрыт для любых contractor-пользователей;
- read и write access возвращают false;
- capability guard отвечает `403 project_forbidden`;
- назначенный contractor сохраняет полный доступ;
- viewer внутри его команды получает только read-only;
- unrelated contractor не наследует доступ;
- membership корректно выбирается при участии пользователя в нескольких командах;
- customer owner и explicit guest не ломаются;
- source contract запрещает возврат fallback `project.contractor_id is None`.
