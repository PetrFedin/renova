"""Repository-wide pytest integrity hooks."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

# Настройки читают ENVIRONMENT при импорте app.*. Без явного значения приложение
# fail-closed (production), поэтому тестовый прогон задаёт профиль явно, до импортов.
os.environ.setdefault("ENVIRONMENT", "test")


@pytest.fixture(autouse=True)
def _reset_local_rate_limiter():
    """Тесты делят один процесс; счётчик лимитера не должен копиться между ними."""
    from app.core.rate_limit import rate_limiter

    with rate_limiter._local_lock:
        rate_limiter._local_windows.clear()
    yield


def pytest_sessionstart(session):
    """Fail any backend test run if fiscal verification regresses to demo truth."""
    backend = Path(__file__).resolve().parent
    verifier = (backend / "app" / "services" / "fns" / "receipt_verify.py").read_text(encoding="utf-8")
    integrity = (backend / "app" / "services" / "receipt_integrity_service.py").read_text(encoding="utf-8")

    for forbidden in (
        '"verified": True, "mode": "demo"',
        '"demo_verify_allowed": True',
        "res.data",
        'return "demo_verified"',
    ):
        if forbidden in verifier or forbidden in integrity:
            raise RuntimeError(f"FNS receipt truth regression: {forbidden}")

    for required in (
        "receipt_verification_truth",
        '"demo_verify_allowed": False',
        "response.json()",
        "VERIFICATION_PENDING",
        "VERIFICATION_FAILED",
        "INVALID",
        "_provider_amounts",
    ):
        if required not in verifier:
            raise RuntimeError(f"FNS receipt integrity contract missing: {required}")

    for required in (
        "verification_pending",
        "verification_failed",
        'normalized == "invalid"',
        'return "saved_unverified"',
        "_apply_state",
    ):
        if required not in integrity:
            raise RuntimeError(f"Receipt state contract missing: {required}")
