"""OAuth scaffold «Мой налог» — honesty: connected только после token exchange.

Без MOY_NALOG_CLIENT_ID: start → authorization_started + oauth_ready=false.
С client_id: auth_url для WebBrowser; callback без валидного code → error.
Demo complete (development): linked flag без live receipts (status ≠ connected).
"""
from __future__ import annotations

import secrets
import time
from urllib.parse import urlencode

from app.core.config import settings

# state → (user_id, exp_ts)
_states: dict[str, tuple[str, float]] = {}
_STATE_TTL = 600


def _prune(now: float) -> None:
    dead = [k for k, (_, exp) in _states.items() if exp < now]
    for k in dead:
        _states.pop(k, None)


def create_oauth_state(user_id: str) -> str:
    _prune(time.time())
    state = secrets.token_urlsafe(24)
    _states[state] = (user_id, time.time() + _STATE_TTL)
    return state


def consume_oauth_state(state: str, user_id: str) -> bool:
    _prune(time.time())
    rec = _states.pop(state, None)
    if not rec:
        return False
    uid, exp = rec
    return uid == user_id and exp >= time.time()


def oauth_ready() -> bool:
    return bool((settings.moy_nalog_client_id or "").strip())


def build_authorize_url(state: str) -> str | None:
    client_id = (settings.moy_nalog_client_id or "").strip()
    if not client_id:
        return None
    redirect = (settings.moy_nalog_redirect_uri or "").strip() or f"{settings.public_base_url.rstrip('/')}/api/v1/fns/moy-nalog/oauth/callback"
    params = {
        "client_id": client_id,
        "response_type": "code",
        "state": state,
        "redirect_uri": redirect,
    }
    base = (settings.moy_nalog_authorize_url or "").strip()
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{urlencode(params)}"


async def exchange_code_for_tokens(code: str) -> dict | None:
    """Real token exchange when token_url + secret set; else None (not connected)."""
    token_url = (settings.moy_nalog_token_url or "").strip()
    secret = (settings.moy_nalog_client_secret or "").strip()
    client_id = (settings.moy_nalog_client_id or "").strip()
    if not (token_url and secret and client_id and code):
        return None
    try:
        import httpx
        redirect = (settings.moy_nalog_redirect_uri or "").strip() or f"{settings.public_base_url.rstrip('/')}/api/v1/fns/moy-nalog/oauth/callback"
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": client_id,
                    "client_secret": secret,
                    "redirect_uri": redirect,
                },
            )
            if r.status_code >= 400:
                return None
            data = r.json()
            if data.get("access_token"):
                return data
    except Exception:
        return None
    return None
