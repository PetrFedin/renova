# OTP atomic consume and lockout integrity

**Дата:** 2026-07-31  
**База:** `main` @ `6547630ba8f4ff06fb2be9607fe5eb7f658d9ee7`  
**Ветка:** `agent/otp-atomic-consume`

## Подтверждённый дефект

Legacy `verify_otp()` выполнял отдельные действия:

1. прочитать digest кода;
2. сравнить candidate;
3. удалить код;
4. очистить failures.

В shared Redis store эти операции не образовывали транзакцию. Два worker/process могли одновременно прочитать один digest до удаления и оба вернуть `True`. Отдельные `INCR`, lock и delete также оставляли промежуточные состояния при конкуренции.

## Новая гарантия

Redis verification выполняется одним Lua script:

- проверить существующий lock;
- прочитать code digest;
- атомарно увеличить failures при missing/mismatch;
- при достижении лимита установить lock и удалить code;
- при совпадении удалить code, failures и lock;
- вернуть единственный результат операции.

Таким образом один OTP имеет не более одного успешного consumer во всех процессах, использующих общий Redis.

Development/test memory-store не используется в staging/production. Для него добавлен per-phone `threading.Lock`, чтобы preview/tests имели ту же single-winner семантику внутри процесса.

## Fail-closed поведение

- staging/production без Redis не переходят на process memory;
- отсутствие Redis или ошибка atomic `EVAL` превращается в `OtpStoreUnavailable`;
- API уже маппит эту ошибку в retryable HTTP 503;
- неверные попытки после лимита блокируют номер и инвалидируют текущий код;
- успешная verify очищает код и счётчик в одной Redis-операции.

## Автоматические проверки

`backend/tests/test_otp_atomic_consume.py`:

1. 16 конкурентных verify в local preview → ровно один `True`;
2. 16 конкурентных verify через thread-safe Redis model → ровно один `True`;
3. пять неверных попыток атомарно создают lock и удаляют код;
4. source guard запрещает возврат к `_get_code()` / `_clear_code()` / `_bump_fail()` внутри `verify_otp()`.

Тест включён в обязательный backend `e2e` CI gate вместе с существующими:

- `test_sms_otp_integrity.py`;
- `test_otp_redis_runtime_integrity.py`.

## Остаточные задачи

Эта волна не заявляет полное закрытие auth abuse surface. Отдельно необходимо проверить:

- граничное истечение TTL и поведение при смене времени;
- rate-limit по phone/IP/device;
- enumeration resistance ответов send/verify;
- recovery/reset tokens и их single-use semantics;
- очистку per-phone lock registries в долгоживущем development process.
