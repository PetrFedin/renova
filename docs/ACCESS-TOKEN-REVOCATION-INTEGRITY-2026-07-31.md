# Access token revocation integrity — 2026-07-31

## Исправленная проблема

Глобальный выход со всех устройств задаёт `users.tokens_invalid_before`. Старый `get_current_user` повторно декодировал access JWT внутри широкого `try/except` и при любой неожиданной ошибке выполнял `except Exception: pass`.

Это создавало fail-open поведение: ошибка декодирования, некорректный `iat`, переполнение даты или другой внутренний сбой могли отключить проверку session epoch и пропустить запрос с токеном, который должен быть отклонён.

Дополнительно access JWT выпускался с целочисленным `iat`. Токен, созданный и отозванный в одну секунду, терял порядок событий на уровне секунд.

## Новая архитектура

1. `access_token_guard.py` является чистым доменным guard для session epoch.
2. Guard проверяет:
   - `sub` совпадает с загруженным пользователем;
   - `typ` является access token;
   - `iat` — конечный числовой NumericDate, не bool/строка/NaN/Infinity;
   - время выпуска не предшествует `tokens_invalid_before`.
3. Aware и naive datetime нормализуются к naive UTC перед сравнением.
4. `get_current_user` вызывает единый `_validate_access_session` без broad-exception bypass.
5. Ошибки классифицируются в 401:
   - invalid/expired JWT;
   - `session_revoked`;
   - invalid subject/type/iat;
   - `session_validation_failed` для неожиданного внутреннего сбоя, который одновременно логируется.
6. `resolve_user_id` также fail-closed при неожиданной ошибке parser/decoder.
7. Новые access JWT сохраняют дробную часть NumericDate `iat`, поэтому revoke-all имеет микросекундную точность.

## Зафиксированные инварианты

`backend/tests/test_access_token_revocation_integrity.py` проверяет:

- новый JWT содержит числовой `iat` с точной временной шкалой;
- токен после cutoff разрешается;
- токен до cutoff отклоняется;
- missing/bool/string/NaN/Infinity `iat` отклоняются;
- mismatch `sub` и неверный `typ` отклоняются;
- обычный `JWTError` и глобальный revoke отображаются в 401;
- неожиданный decoder failure закрывает доступ и не продолжает request;
- в блоке `get_current_user` отсутствует `except Exception`.

Тест включён в обязательный backend CI вместе с authentication, OTP, delivery, financial, dashboard и viewer integrity checks.
