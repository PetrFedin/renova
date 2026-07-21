"""Access token carries jti."""
from app.core.security import create_access_token, decode_access_token


def test_access_token_has_jti():
    tok = create_access_token("user-1", {"role": "customer"})
    payload = decode_access_token(tok)
    assert payload.get("sub") == "user-1"
    assert payload.get("jti")
    assert len(str(payload["jti"])) >= 8
