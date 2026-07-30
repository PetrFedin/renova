"""Repository-wide pytest integrity hooks."""
from __future__ import annotations

from pathlib import Path


def pytest_sessionstart(session):
    """Fail any backend test run if fiscal verification regresses to demo truth."""
    backend = Path(__file__).resolve().parent
    verifier = (backend / "app" / "services" / "fns" / "receipt_verify.py").read_text(
        encoding="utf-8"
    )
    integrity = (backend / "app" / "services" / "receipt_integrity_service.py").read_text(
        encoding="utf-8"
    )

    for forbidden in (
        '"verified": True, "mode": "demo"',
        "demo_verify_allowed = True",
        "res.data",
    ):
        if forbidden in verifier:
            raise RuntimeError(f"FNS receipt truth regression: {forbidden}")

    for required in (
        "receipt_verification_truth",
        '"demo_verify_allowed": False',
        "response.json()",
        "VERIFICATION_PENDING",
        "VERIFICATION_FAILED",
    ):
        if required not in verifier:
            raise RuntimeError(f"FNS receipt integrity contract missing: {required}")

    if 'explicit == "demo_verified"' not in integrity:
        raise RuntimeError("Legacy demo receipt downgrade contract missing")
    if 'return "saved_unverified"' not in integrity:
        raise RuntimeError("Legacy demo receipt must downgrade to saved_unverified")
