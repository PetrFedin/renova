from __future__ import annotations

import inspect
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.services import otp_service


class AtomicRedis:
    """Thread-safe Redis model for OTP Lua and expiry contracts."""

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

    def time(self):
        seconds, remainder_ms = divmod(self.server_ms, 1000)
        return seconds, remainder_ms * 1000

    def get(self, key):
        with self._lock:
            self._expire(key)
            return self.values.get(key)

    def delete(self, *keys):
        with self._lock:
            deleted = 0
            for key in keys:
                deleted += int(key in self.values)
                self.values.pop(key, None)
                self.expires_at_ms.pop(key, None)
            return deleted

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
                assert numkeys == 1
                code_key = args[0]
                digest = str(args[1])
                ttl_ms = int(args[2])
                if ttl_ms <= 0:
                    self.values.pop(code_key, None)
                    self.expires_at_ms.pop(code_key, None)
                    return 0
                deadline_ms = self.server_ms + ttl_ms
                self.values[code_key] = f"v2|{deadline_ms}|{digest}"
                self.expires_at_ms[code_key] = deadline_ms
                return deadline_ms

            if script == otp_service._CLEAR_OTP_IF_DIGEST_SCRIPT:
                assert numkeys == 1
                code_key = args[0]
                expected_digest = str(args[1])
                self._expire(code_key)
                stored = self.values.get(code_key)
                if not stored:
                    return 0
                stored_digest, _deadline = otp_service._unpack_redis_code(stored)
                if stored_digest != expected_digest:
                    return 0
                self.values.pop(code_key, None)
                self.expires_at_ms.pop(code_key, None)
                return 1

            assert script == otp_service._VERIFY_OTP_SCRIPT
            assert numkeys == 3
            lock_key, code_key, fails_key = args[:3]
            candidate, max_fails, lock_seconds = args[3:]
            max_fails = int(max_fails)
            lock_seconds = int(lock_seconds)
            self.eval_calls += 1

            def register_failure(reason: str) -> str:
                failures = int(self.values.get(fails_key, "0")) + 1
                if failures >= max_fails:
                    self.values[lock_key] = str(self.server_ms // 1000 + lock_seconds)
                    self.expires_at_ms[lock_key] = self.server_ms + lock_seconds * 1000
                    self.values.pop(fails_key, None)
                    self.values.pop(code_key, None)
                    self.expires_at_ms.pop(code_key, None)
                    return "locked"
                self.values[fails_key] = str(failures)
                self.expires_at_ms[fails_key] = self.server_ms + lock_seconds * 1000
                return reason

            if self._exists(lock_key):
                return "locked"

            self._expire(code_key)
            stored = self.values.get(code_key)
            if stored is None:
                return register_failure("missing")

            stored_digest, deadline_ms = otp_service._unpack_redis_code(stored)
            if deadline_ms is not None and self.server_ms >= deadline_ms:
                self.values.pop(code_key, None)
                self.expires_at_ms.pop(code_key, None)
                return register_failure("expired")

            if stored_digest != candidate:
                return register_failure("mismatch")

            self.values.pop(code_key, None)
            self.expires_at_ms.pop(code_key, None)
            self.values.pop(fails_key, None)
            self.expires_at_ms.pop(fails_key, None)
            self.values.pop(lock_key, None)
            self.expires_at_ms.pop(lock_key, None)
            return "ok"


@pytest.fixture(autouse=True)
def reset_otp_state(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "test")
    monkeypatch.setattr(otp_service.settings, "redis_url", None)
    monkeypatch.setattr(otp_service.settings, "secret_key", "test-secret-key-at-least-16")
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_service._store.clear()
    otp_service._send_log.clear()
    otp_service._fail_count.clear()
    otp_service._lock_until.clear()
    otp_service._send_inflight.clear()
    otp_service._verify_locks.clear()
    yield
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_service._store.clear()
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


def test_clear_code_if_matches_supports_versioned_record(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis(server_ms=500_000)
    _use_redis(monkeypatch, redis)
    digest = otp_service._digest(phone, "123456")
    key = otp_service._rk("code", phone)
    redis.values[key] = f"v2|800000|{digest}"
    redis.expires_at_ms[key] = 800_000

    otp_service._clear_code_if_matches(phone, digest)

    assert key not in redis.values


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


def test_expiry_contract_is_fail_closed_on_both_backends():
    local_source = inspect.getsource(otp_service._verify_local)

    assert "now >= expires_at" in local_source
    assert "redis.call('time')" in otp_service._STORE_OTP_SCRIPT
    assert "now_ms >= tonumber(deadline_raw)" in otp_service._VERIFY_OTP_SCRIPT
    assert "'PX', ttl_ms" in otp_service._STORE_OTP_SCRIPT
