from __future__ import annotations

import inspect
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.services import otp_service


class AtomicRedis:
    """Minimal thread-safe Redis model for the OTP Lua contract."""

    def __init__(self):
        self.values: dict[str, str] = {}
        self._lock = threading.Lock()
        self.eval_calls = 0

    def eval(self, script, numkeys, *args):
        assert script == otp_service._VERIFY_OTP_SCRIPT
        assert numkeys == 3
        lock_key, code_key, fails_key = args[:3]
        candidate, max_fails, _lock_seconds, lock_until = args[3:]
        max_fails = int(max_fails)

        with self._lock:
            self.eval_calls += 1
            if lock_key in self.values:
                return "locked"

            stored = self.values.get(code_key)
            if stored is None:
                failures = int(self.values.get(fails_key, "0")) + 1
                if failures >= max_fails:
                    self.values[lock_key] = str(lock_until)
                    self.values.pop(fails_key, None)
                    return "locked"
                self.values[fails_key] = str(failures)
                return "missing"

            if stored != candidate:
                failures = int(self.values.get(fails_key, "0")) + 1
                if failures >= max_fails:
                    self.values[lock_key] = str(lock_until)
                    self.values.pop(fails_key, None)
                    self.values.pop(code_key, None)
                    return "locked"
                self.values[fails_key] = str(failures)
                return "mismatch"

            self.values.pop(code_key, None)
            self.values.pop(fails_key, None)
            self.values.pop(lock_key, None)
            return "ok"


@pytest.fixture(autouse=True)
def reset_otp_state(monkeypatch):
    monkeypatch.setattr(otp_service.settings, "environment", "test")
    monkeypatch.setattr(otp_service.settings, "redis_url", None)
    monkeypatch.setattr(otp_service.settings, "secret_key", "test-secret-key-at-least-16")
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_service._store.clear()
    otp_service._fail_count.clear()
    otp_service._lock_until.clear()
    otp_service._verify_locks.clear()
    yield
    otp_service._redis = None
    otp_service._redis_failed = False
    otp_service._store.clear()
    otp_service._fail_count.clear()
    otp_service._lock_until.clear()
    otp_service._verify_locks.clear()


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


def test_redis_code_has_exactly_one_concurrent_winner(monkeypatch):
    phone = "+79991234567"
    code = "123456"
    redis = AtomicRedis()
    redis.values[otp_service._rk("code", phone)] = otp_service._digest(phone, code)
    monkeypatch.setattr(otp_service.settings, "environment", "production")
    monkeypatch.setattr(otp_service.settings, "redis_url", "redis://redis.example.com:6379/0")
    otp_service._redis = redis

    results = _run_concurrently(lambda: otp_service.verify_otp(phone, code))

    assert results.count(True) == 1
    assert results.count(False) == 15
    assert otp_service._rk("code", phone) not in redis.values
    assert redis.eval_calls == 16


def test_redis_failed_attempts_and_lockout_are_one_atomic_contract(monkeypatch):
    phone = "+79991234567"
    redis = AtomicRedis()
    redis.values[otp_service._rk("code", phone)] = otp_service._digest(phone, "123456")
    monkeypatch.setattr(otp_service.settings, "environment", "production")
    monkeypatch.setattr(otp_service.settings, "redis_url", "redis://redis.example.com:6379/0")
    otp_service._redis = redis

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
