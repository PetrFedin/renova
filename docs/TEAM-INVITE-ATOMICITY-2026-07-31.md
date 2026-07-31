# Team invite atomicity — 2026-07-31

## Исправленная проблема

`join_by_token` сначала читал `TeamInvite` с `used=false`, затем отдельно создавал membership и только после этого выставлял `used=true`.

Два параллельных запроса могли одновременно увидеть активную одноразовую ссылку и оба вступить в бригаду. В результате single-use token фактически становился multi-use.

Соседний `invite_phone` также выполнял прямой check-then-insert против unique constraint `uq_team_member(team_id, user_id)`, а сбой уведомления скрывался через silent `except Exception: pass`.

## Новая транзакционная модель

1. `join_by_token` погашает invite одним conditional update:
   - token совпадает;
   - `used=false`;
   - `expires_at >= now`;
   - `used` атомарно меняется на `true`;
   - `RETURNING` отдаёт `team_id` и роль только победившему запросу.
2. Второй параллельный запрос не получает строку из `RETURNING`, откатывает пустую транзакцию и возвращает «Ссылка недействительна».
3. `ensure_team_membership` создаёт membership внутри savepoint:
   - последовательный повтор возвращает существующую запись;
   - конкурентная unique-коллизия откатывает только savepoint и перечитывает canonical membership;
   - commit остаётся ответственностью вызывающей бизнес-операции.
4. Если создание membership после claim завершается неожиданной ошибкой, вся транзакция откатывается, включая `used=true`; ссылка не теряется без созданного доступа.
5. Допустимые роли централизованы в `TEAM_MEMBER_ROLES`: `member`, `viewer`, `foreman`.
6. `invite_phone`, `create_invite_link` и `set_member_role` используют одну role validation.
7. Notification failure после успешного membership commit логируется с `team_id` и `user_id`, но не отменяет уже созданное членство.
8. Production route больше не содержит demo-copy; первое создание бригады при invite-link остаётся штатным onboarding-механизмом.

## Инварианты CI

`backend/tests/test_team_invite_atomicity.py` проверяет:

- два одновременных redemption дают ровно одного победителя;
- invite становится `used=true`, а membership создаётся ровно одна;
- существующий membership не дублируется, но invite корректно погашается;
- expired и reused token не создают доступ;
- недопустимая роль отклоняется;
- notification failure явно логируется;
- source contract требует conditional `UPDATE ... RETURNING` и запрещает предварительный `SELECT TeamInvite`;
- в invite path нет silent `except Exception: pass`;
- в teams route отсутствует demo-copy.
