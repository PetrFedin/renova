from __future__ import annotations

import inspect
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from app.services import otp_service


class AtomicRedis:
    """Thread-safe Redis model for OTP Lua, replacement and expiry contracts."""

    def __init__(self, *, server_ms: int = 1_000_000):
        self.values: dict[str, str] = {}
        self.expires_at_ms: dict[str, int] = {}
        self.server_ms = server_ms
        self._lock = threading.Lock()
        self.eval_calls = 0

    def _expire(self, key: str) -> None:
        deadline = self.expires_at_ms.get(key)
        if deadline is not None and self.server_ms >= deadline:
            self.values.pop(key, None)
            self.expires_at_ms.pop(key, None)

    def _exists(self, key: str) -> bool:
        self._expire(key)
        return key in self.values

    def _delete_unlocked(self, *keys: str) -> int:
        deleted = 0
        for key in keys:
            deleted += int(key in self.values)
            self.values.pop(key, None)
            self.expires_at_ms.pop(key, None)
        return deleted

    def _set_px(self, key: str, value: str, ttl_ms: int) -> None:
        self.values[key] = value
        self.expires_at_ms[key] = self.server_ms + ttl_ms

    def time(self):
        seconds, remainder_ms = divmod(self.server_ms, 1000)
        return seconds, remainder_ms * 1000

    def get(self, key):
        with self._lock:
            self._expire(key)
            return self.values.get(key)

    def delete(self, *keys):
        with self._lock:
            return self._delete_unlocked(*keys)

    def pttl(self, key):
        with self._lock:
            self._expire(key)
            if key not in self.values:
                return -2
            deadline = self.expires_at_ms.get(key)
            return -1 if deadline is None else max(0, deadline - self.server_ms)

    def eval(self, script, numkeys, *args):
        with self._lock:
            if script == otp_service._STORE_OTP_SCRIPT:
                assert numkeys == 2
                code_key, generation_key = args[:2]
                digest = str(args[2])
                ttl_ms = int(args[3])
                if ttl_ms <= 0:
                    self._delete_unlocked(code_key, generation_key)
                    return 0
                deadline_ms = self.server_ms + ttl_ms
                self._set_px(code_key, f"v2|{deadline_ms}|{digest}", ttl_ms)
                self._delete_unlocked(generation_key)
                return deadline_ms

            if script == otp_service._SWAP_OTP_SCRIPT:
                assert numkeys == 2
                code_key, generation_key = args[:2]
                digest = str(args[2])
                ttl_ms = int(args[3])
                generation = str(args[4])
                if ttl_ms <= 0:
                    return ""

                self._expire(code_key)
                previous = ""
                stored = self.values.get(code_key)
                if stored:
                    stored_digest, stored_deadline = otp_service._unpack_redis_code(stored)
                    if stored_deadline is not None:
                        if stored_digest and self.server_ms < stored_deadline:
                            previous = stored
                    else:
                        cleanup_deadline = self.expires_at_ms.get(code_key)
                        if cleanup_deadline and cleanup_deadline > self.server_ms:
                            previous = f"v2|{cleanup_deadline}|{stored}"

                deadline_ms = self.server_ms + ttl_ms
                self._set_px(code_key, f"v2|{deadline_ms}|{digest}", ttl_ms)
                self._set_px(generation_key, generation, ttl_ms)
                return previous

            if script == otp_service._ROLLBACK_OTP_SCRIPT:
                assert numkeys == 2
                code_key, generation_key = args[:2]
                expected_generation = str(args[2])
                previous = str(args[3])
                self._expire(code_key)
                self._expire(generation_key)
                if self.values.get(generation_key) != expected_generation:
                    return 0
                if code_key not in self.values:
                    self._delete_unlocked(generation_key)
                    return 0

                if previous:
                    previous_digest, previous_deadline = otp_service._unpack_redis_code(previous)
                    if (
                        previous_digest
                        and previous_deadline is not None
                        and previous_deadline > self.server_ms
                    ):
                        self.values[code_key] = previous
                        self.expires_at_ms[code_key] = previous_deadline
                    else:
                        self._delete_unlocked(code_key)
                else:
                    self._delete_unlocked(code_key)
                self._delete_unlocked(generation_key)
                return 1

            if script == otp_service._CLEAR_OTP_IF_DIGEST_SCRIPT:
                assert numkeys == 2
                code_key, generation_key = args[:2]
                expected_digest = str(args[2])
                self._expire(code_key)
                stored = self.values.get(code_key)
                if not stored:
                    self._delete_unlocked(generation_key)
                    return 0
                stored_digest, _deadline = otp_service._unpack_redis_code(stored)
                if stored_digest != expected_digest:
                    return 0
                self._delete_unlocked(code_key, generation_key)
                return 1

            assert script == otp_service._VERIFY_OTP_SCRIPT
            assert numkeys == 4
            lock_key, code_key, fails_key, generation_key = args[:4]
            candidate, max_fails, lock_seconds = args[4:]
            max_fails = int(max_fails)
            lock_seconds = int(lock_seconds)
            self.eval_calls += 1

            def register_failure(reason: str) -> str:
                failures = int(self.values.get(fails_key, "0")) + 1
                if failures >= max_fails:
                    self.values[lock_key] = str(self.server_ms // 1000 + lock_seconds)
                    self.expires_at_ms[lock_key] = self.server_ms + lock_seconds * 1000
                    self._delete_unlocked(fails_key, code_key, generation_key)
                    return "locked"
                self.values[fails_key] = str(failures)
                self.expires_at_ms[fails_key] = self.server_ms + lock_seconds * 1000
                return reason

            if self._exists(lock_key):
                return "locked"

            self._expire(code_key)
            stored = self.values.get(code_key)
            if stored is None:
                self._delete_unlocked(generation_key)
                return register_failure("missing")

            stored_digest, deadline_ms = otp_service._unpack_redis_code(stored)
            if deadline_ms is not None and self.server_ms >= deadline_ms:
                self._delete_unlocked(code_key, generation_key)
                return register_failure("expired")

            if stored_digest != candidate:
                return register_failure("mismatch")

            self._delete_unlocked(
                code_key,
                generation_key,
                fails_key,
                lock_key,
            )
            return "ok"


@pytest.fixture(autouse=True)
def reset_otp_state(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "test")
    monkeypatch.setattr(otp_service.settings, "redis_url", None)
    monkeypatch.setattr(otp_service.settings, "secret_key", "test-secret-key-at-least-16")
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_service._store.clear()
    otp_service._code_generation.clear()
    otp_service._send_log.clear()
    otp_service._fail_count.clear()
    otp_service._lock_until.clear()
    otp_service._send_inflight.clear()
    otp_service._verify_locks.clear()
    yield
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_service._store.clear()
    otp_service._code_generation.clear()
    otp_service._send_log.clear()
    otp_service._fail_count.clear()
    otp_service._lock_until.clear()
    otp_service._send_inflight.clear()
    otp_service._verify_locks.clear()


def _use_redis(monkeypatch, redis: AtomicRedis) -> None:
    monkeypatch.setattr(otp_service.settings, "environment", "production")
    monkeypatch.setattr(
        otp_service.settings,
        "redis_url",
        "redis://redis.example.com:6379/0",
    )
    otp_service._redis = redis


def _run_concurrently(callable_, workers: int = 16) -> list[bool]:
    barrier = threading.Barrier(workers)

    def invoke():
        barrier.wait()
        return callable_()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(lambda _index: invoke(), range(workers)))


def test_local_preview_code_has_exactly_one_concurrent_winner():
    phone = "+79991234567"
    code = "123456"
    otp_service._store[phone] = (
        otp_service._digest(phone, code),
        time.time() + 60,
    )

    results = _run_concurrently(lambda: otp_service.verify_otp(phone, code))

    assert results.count(True) == 1
    assert results.count(False) == 15
    assert phone not in otp_service._store


def test_local_code_is_invalid_at_exact_expiry():
    phone = "+79991234567"
    code = "123456"
    exact_boundary = 2_000.0
    candidate = otp_service._digest(phone, code)
    otp_service._store[phone] = (candidate, exact_boundary)

    assert otp_service._verify_local(phone, candidate, exact_boundary) is False
    assert phone not in otp_service._store


def test_local_rollback_restores_previous_code_when_replacement_is_untouched():
    phone = "+79991234567"
    old_code = "654321"
    new_code = "123456"
    otp_service._store[phone] = (
        otp_service._digest(phone, old_code),
        time.time() + 60,
    )

    swap = otp_service._swap_code(
        phone,
        otp_service._digest(phone, new_code),
        time.time() + 60,
    )

    assert otp_service._rollback_code(phone, swap) is True
    assert otp_service.verify_otp(phone, old_code) is True
    assert otp_service.verify_otp(phone, new_code) is False


def test_local_rollback_cannot_resurrect_old_code_after_new_code_is_consumed():
    phone = "+79991234567"
    old_code = "654321"
    new_code = "123456"
    otp_service._store[phone] = (
        otp_service._digest(phone, old_code),
        time.time() + 60,
    )

    swap = otp_service._swap_code(
        phone,
        otp_service._digest(phone, new_code),
        time.time() + 60,
    )
    assert otp_service.verify_otp(phone, new_code) is True

    assert otp_service._rollback_code(phone, swap) is False
    assert otp_service.verify_otp(phone, old_code) is False


def test_local_older_rollback_cannot_replace_a_newer_resend():
    phone = "+79991234567"
    first = otp_service._swap_code(
        phone,
        otp_service._digest(phone, "111111"),
        time.time() + 60,
    )
    second = otp_service._swap_code(
        phone,
        otp_service._digest(phone, "222222"),
        time.time() + 60,
    )

    assert otp_service._rollback_code(phone, first) is False
    assert otp_service.verify_otp(phone, "222222") is True
    assert otp_service._rollback_code(phone, second) is False


@pytest.mark.asyncio
async def test_delivery_failure_restores_previous_local_code(monkeypatch):
    phone = "+79991234567"
    old_code = "654321"
    otp_service._store[phone] = (
        otp_service._digest(phone, old_code),
        time.time() + 60,
    )

    async def failed_delivery(_phone: str, _message: str):
        return SimpleNamespace(delivered=False, preview=False)

    monkeypatch.setattr(otp_service, "send_sms", failed_delivery)
    response = await otp_service.send_otp(phone)

    assert response["ok"] is False
    assert response["service_unavailable"] is True
    assert otp_service.verify_otp(phone, old_code) is True


@pytest.mark.asyncio
async def test_delivery_failure_cannot_restore_old_code_after_new_code_was_consumed(monkeypatch):
    phone = "+79991234567"
    old_code = "654321"
    new_code = "123456"
    otp_service._store[phone] = (
        otp_service._digest(phone, old_code),
        time.time() + 60,
    )
    monkeypatch.setattr(otp_service.secrets, "randbelow", lambda _limit: int(new_code))

    async def consumed_then_failed(_phone: str, _message: str):
        assert otp_service.verify_otp(phone, new_code) is True
        return SimpleNamespace(delivered=False, preview=False)

    monkeypatch.setattr(otp_service, "send_sms", consumed_then_failed)
    response = await otp_service.send_otp(phone)

    assert response["ok"] is False
    assert otp_service.verify_otp(phone, old_code) is False


def test_redis_code_has_exactly_one_concurrent_winner(monkeypatch):
    phone = "+79991234567"
    code = "123456"
    redis = AtomicRedis()
    redis.values[otp_service._rk("code", phone)] = otp_service._digest(phone, code)
    _use_redis(monkeypatch, redis)

    results = _run_concurrently(lambda: otp_service.verify_otp(phone, code))

    assert results.count(True) == 1
    assert results.count(False) == 15
    assert otp_service._rk("code", phone) not in redis.values
    assert redis.eval_calls == 16


def test_redis_versioned_code_is_valid_one_millisecond_before_deadline(monkeypatch):
    phone = "+79991234567"
    code = "123456"
    redis = AtomicRedis(server_ms=9_999)
    digest = otp_service._digest(phone, code)
    redis.values[otp_service._rk("code", phone)] = f"v2|10000|{digest}"
    redis.expires_at_ms[otp_service._rk("code", phone)] = 10_000
    _use_redis(monkeypatch, redis)

    assert otp_service.verify_otp(phone, code) is True


def test_redis_versioned_code_is_invalid_at_exact_server_deadline(monkeypatch):
    phone = "+79991234567"
    code = "123456"
    redis = AtomicRedis(server_ms=10_000)
    digest = otp_service._digest(phone, code)
    redis.values[otp_service._rk("code", phone)] = f"v2|10000|{digest}"
    _use_redis(monkeypatch, redis)

    assert otp_service.verify_otp(phone, code) is False
    assert otp_service._rk("code", phone) not in redis.values


def test_store_code_uses_redis_server_clock_and_embedded_deadline(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis(server_ms=500_000)
    _use_redis(monkeypatch, redis)
    monkeypatch.setattr(otp_service.time, "time", lambda: 1_000.0)
    digest = otp_service._digest(phone, "123456")

    otp_service._store_code(phone, digest, 1_000.5)

    key = otp_service._rk("code", phone)
    assert redis.values[key] == f"v2|500500|{digest}"
    assert redis.pttl(key) == 500


def test_redis_rollback_restores_previous_deadline_not_a_fresh_ttl(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis(server_ms=100_000)
    _use_redis(monkeypatch, redis)
    old_digest = otp_service._digest(phone, "654321")
    key = otp_service._rk("code", phone)
    redis.values[key] = f"v2|105000|{old_digest}"
    redis.expires_at_ms[key] = 105_000

    swap = otp_service._swap_code(
        phone,
        otp_service._digest(phone, "123456"),
        time.time() + 60,
    )
    redis.server_ms = 102_000

    assert otp_service._rollback_code(phone, swap) is True
    assert redis.values[key] == f"v2|105000|{old_digest}"
    assert redis.pttl(key) == 3_000


def test_redis_rollback_cannot_resurrect_consumed_previous_code(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis(server_ms=100_000)
    _use_redis(monkeypatch, redis)
    old_code = "654321"
    new_code = "123456"
    old_digest = otp_service._digest(phone, old_code)
    key = otp_service._rk("code", phone)
    redis.values[key] = f"v2|160000|{old_digest}"
    redis.expires_at_ms[key] = 160_000

    swap = otp_service._swap_code(
        phone,
        otp_service._digest(phone, new_code),
        time.time() + 60,
    )
    assert otp_service.verify_otp(phone, new_code) is True

    assert otp_service._rollback_code(phone, swap) is False
    assert otp_service.verify_otp(phone, old_code) is False


def test_redis_swap_normalizes_legacy_previous_digest(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis(server_ms=100_000)
    _use_redis(monkeypatch, redis)
    old_digest = otp_service._digest(phone, "654321")
    key = otp_service._rk("code", phone)
    redis.values[key] = old_digest
    redis.expires_at_ms[key] = 105_000

    swap = otp_service._swap_code(
        phone,
        otp_service._digest(phone, "123456"),
        time.time() + 60,
    )

    assert swap.previous_raw == f"v2|105000|{old_digest}"


def test_clear_code_if_matches_supports_versioned_record(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis(server_ms=500_000)
    _use_redis(monkeypatch, redis)
    digest = otp_service._digest(phone, "123456")
    key = otp_service._rk("code", phone)
    generation_key = otp_service._rk("code-generation", phone)
    redis.values[key] = f"v2|800000|{digest}"
    redis.expires_at_ms[key] = 800_000
    redis.values[generation_key] = "generation"
    redis.expires_at_ms[generation_key] = 800_000

    otp_service._clear_code_if_matches(phone, digest)

    assert key not in redis.values
    assert generation_key not in redis.values


def test_redis_lock_countdown_uses_pttl_not_application_clock(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis(server_ms=10_000)
    _use_redis(monkeypatch, redis)
    key = otp_service._rk("lock", phone)
    redis.values[key] = "untrusted-wall-clock-value"
    redis.expires_at_ms[key] = 11_250

    assert otp_service._lock_left(phone, now=9_999_999.0) == 2


def test_redis_failed_attempts_and_lockout_are_one_atomic_contract(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis()
    redis.values[otp_service._rk("code", phone)] = otp_service._digest(phone, "123456")
    _use_redis(monkeypatch, redis)

    for _ in range(otp_service._MAX_VERIFY_FAILS):
        assert otp_service.verify_otp(phone, "000000") is False

    assert otp_service._rk("lock", phone) in redis.values
    assert otp_service._rk("code", phone) not in redis.values
    assert otp_service.verify_otp(phone, "123456") is False


def test_verify_otp_uses_atomic_redis_script_not_read_then_delete():
    source = inspect.getsource(otp_service.verify_otp)

    assert "redis_client.eval(" in source
    assert "_VERIFY_OTP_SCRIPT" in source
    assert "_get_code(" not in source
    assert "_clear_code(" not in source
    assert "_bump_fail(" not in source


def test_send_uses_atomic_swap_and_conditional_rollback_contract():
    source = inspect.getsource(otp_service.send_otp)

    assert "_swap_code(" in source
    assert "_rollback_code(" in source
    assert "_get_code(" not in source
    assert "_restore_code(" not in source
    assert "code-generation" in otp_service._ROLLBACK_OTP_SCRIPT or "generation_key" in otp_service._ROLLBACK_OTP_SCRIPT


def test_expiry_contract_is_fail_closed_on_both_backends():
    local_source = inspect.getsource(otp_service._verify_local)

    assert "now >= expires_at" in local_source
    assert "redis.call('time')" in otp_service._STORE_OTP_SCRIPT
    assert "now_ms >= tonumber(deadline_raw)" in otp_service._VERIFY_OTP_SCRIPT
    assert "'PX', ttl_ms" in otp_service._STORE_OTP_SCRIPT
