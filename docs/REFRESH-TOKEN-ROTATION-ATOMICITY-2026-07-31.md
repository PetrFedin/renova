# Refresh token rotation atomicity — 2026-07-31

## Исправленная уязвимость

Старый `rotate_session` выполнял rotation в несколько раздельных шагов:

1. `SELECT` активной сессии по hash;
2. установка `revoked_at`;
3. отдельный commit;
4. создание replacement через `create_session`;
5. второй commit.

Два параллельных запроса могли одновременно прочитать `revoked_at IS NULL`, оба отозвать одну исходную сессию и выпустить два независимых refresh token. Кроме того, сбой между двумя commit мог отозвать старую сессию, но не создать замену.

## Новая транзакционная модель

1. Rotation начинается с одного conditional update:
   - совпадает `refresh_token_hash`;
   - `revoked_at IS NULL`;
   - old session атомарно получает `revoked_at` и `last_used_at`;
   - `RETURNING` передаёт metadata только одному победителю.
2. Второй конкурентный запрос не получает строку и возвращает invalid refresh без выпуска новой сессии.
3. Replacement создаётся и flush-ится до того же commit, которым фиксируется отзыв старого token.
4. Любой сбой mint/insert/flush/commit вызывает rollback всей rotation-транзакции. Старый token остаётся активным, если новый не был создан.
5. Expired token также атомарно claim-ится и фиксируется revoked, но replacement для него не выпускается.
6. `revoke_session` и `revoke_all_user_sessions` переведены с read-loop-write на conditional `UPDATE ... RETURNING`, поэтому их результат и счётчик формируются атомарно.
7. Параметры device/IP/user-agent переносятся в replacement без промежуточного повторного чтения.

## Инварианты CI

`backend/tests/test_refresh_token_rotation_atomicity.py` проверяет:

- два одновременных rotation-запроса дают ровно один replacement;
- в базе остаётся одна active session и одна revoked original session;
- device/IP/user-agent сохраняются;
- expired refresh отзывается без replacement;
- unique collision нового token hash откатывает claim исходной сессии;
- revoke одного token и revoke-all идемпотентны;
- source contract требует conditional `UPDATE ... RETURNING`, flush до commit и запрещает предварительный `SELECT UserSession` в rotation path.
