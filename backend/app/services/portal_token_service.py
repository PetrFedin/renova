"""Magic link signed token для web client portal (P2.1) — stdlib HMAC."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from app.core.config import settings


def _sign(body: str) -> str:
    return hmac.new(settings.secret_key.encode(), body.encode(), hashlib.sha256).hexdigest()


def create_portal_token(*, project_id: str, user_id: str, ttl_hours: int = 168, scopes: list[str] | None = None) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "project_id": project_id,
        "read_only": not (scopes and "accept_stage" in scopes),
        "scopes": scopes or ["read"],
        "iat": now,
        "exp": now + ttl_hours * 3600,
    }
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{body}.{_sign(body)}"


def verify_portal_token(token: str) -> dict:
    if "." not in token:
        raise ValueError("invalid_portal_token")
    body, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(_sign(body), sig):
        raise ValueError("invalid_portal_token")
    pad = "=" * (-len(body) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + pad))
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError("invalid_portal_token") from exc
    if payload.get("exp", 0) < int(time.time()):
        raise ValueError("expired_portal_token")
    if not payload.get("project_id") or not payload.get("sub"):
        raise ValueError("invalid_portal_token")
    return {
        "user_id": str(payload["sub"]),
        "project_id": str(payload["project_id"]),
        "read_only": bool(payload.get("read_only", True)),
        "scopes": list(payload.get("scopes") or ["read"]),
    }


def portal_url(token: str) -> str:
    base = (settings.public_base_url or "http://127.0.0.1:8081").rstrip("/")
    return f"{base}/portal?token={token}"
