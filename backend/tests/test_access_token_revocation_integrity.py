from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from jose import JWTError

from app.api import deps
from app.core.security import create_access_token, decode_access_token
from app.services.access_token_guard import (
    AccessTokenGuardError,
    AccessTokenRevoked,
    assert_access_token_not_revoked,
    issued_at_utc_naive,
)


def test_new_access_tokens_keep_fractional_issued_at_precision():
    payload = decode_access_token(create_access_token("revocation-user"))

    assert isinstance(payload["iat"], float)
    assert payload["iat"] > 0


def test_guard_accepts_token_issued_after_aware_cutoff():
    cutoff = datetime.now(timezone.utc)
    payload = {
        "sub": "user-1",
        "typ": "access",
        "iat": (cutoff + timedelta(microseconds=1)).timestamp(),
    }

    assert_access_token_not_revoked(
        payload,
        user_id="user-1",
        invalid_before=cutoff,
    )


def test_guard_rejects_token_issued_before_cutoff():
    cutoff = datetime.now(timezone.utc)
    payload = {
        "sub": "user-1",
        "typ": "access",
        "iat": (cutoff - timedelta(seconds=1)).timestamp(),
    }

    with pytest.raises(AccessTokenRevoked, match="session_revoked"):
        assert_access_token_not_revoked(
            payload,
            user_id="user-1",
            invalid_before=cutoff,
        )


@pytest.mark.parametrize("iat", [None, True, "123", float("nan"), float("inf")])
def test_guard_rejects_missing_or_non_finite_iat(iat):
    with pytest.raises(AccessTokenGuardError, match="session_token_invalid_iat"):
        issued_at_utc_naive({"iat": iat})


def test_guard_rejects_subject_and_token_type_mismatch():
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=1)

    with pytest.raises(AccessTokenGuardError, match="subject_mismatch"):
        assert_access_token_not_revoked(
            {"sub": "other", "typ": "access", "iat": datetime.now(timezone.utc).timestamp()},
            user_id="user-1",
            invalid_before=cutoff,
        )
    with pytest.raises(AccessTokenGuardError, match="wrong_type"):
        assert_access_token_not_revoked(
            {"sub": "user-1", "typ": "refresh", "iat": datetime.now(timezone.utc).timestamp()},
            user_id="user-1",
            invalid_before=cutoff,
        )


def test_session_validation_fails_closed_on_unexpected_decoder_error(monkeypatch):
    monkeypatch.setattr(deps, "decode_access_token", lambda _token: (_ for _ in ()).throw(RuntimeError("boom")))

    with pytest.raises(HTTPException) as exc:
        deps._validate_access_session(
            "Bearer token",
            user_id="user-1",
            invalid_before=datetime.now(timezone.utc),
        )

    assert exc.value.status_code == 401
    assert exc.value.detail == "session_validation_failed"


def test_session_validation_maps_jwt_and_revocation_errors(monkeypatch):
    monkeypatch.setattr(deps, "decode_access_token", lambda _token: (_ for _ in ()).throw(JWTError("bad")))
    with pytest.raises(HTTPException) as invalid:
        deps._validate_access_session(
            "Bearer token",
            user_id="user-1",
            invalid_before=datetime.now(timezone.utc),
        )
    assert invalid.value.status_code == 401

    cutoff = datetime.now(timezone.utc)
    monkeypatch.setattr(
        deps,
        "decode_access_token",
        lambda _token: {
            "sub": "user-1",
            "typ": "access",
            "iat": (cutoff - timedelta(seconds=1)).timestamp(),
        },
    )
    with pytest.raises(HTTPException) as revoked:
        deps._validate_access_session(
            "Bearer token",
            user_id="user-1",
            invalid_before=cutoff,
        )
    assert revoked.value.status_code == 401
    assert revoked.value.detail == "session_revoked"


def test_get_current_user_source_has_no_revocation_bypass():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "api" / "deps.py").read_text(encoding="utf-8")
    start = source.index("async def get_current_user")
    end = source.index("async def require_project", start)
    block = source[start:end]

    assert "except Exception" not in block
    assert "_validate_access_session" in block
    assert "session_revoked" not in block  # mapping stays centralized in the guard adapter
