"""Fail-closed OAuth state and token storage for «Мой налог»."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_STATE_TTL = 600
_MIN_TOKEN_TTL = 60
_MAX_TOKEN_TTL = 60 * 60 * 24 * 30
_redis = None
_redis_failed = False


class MoyNalogOAuthError(RuntimeError):
    code = "moy_nalog_oauth_error"
    http_status = 502


class MoyNalogConfigurationError(MoyNalogOAuthError):
    code = "moy_nalog_not_configured"
    http_status = 503


class MoyNalogStateError(MoyNalogOAuthError):
    code = "moy_nalog_invalid_state"
    http_status = 400


class MoyNalogProviderError(MoyNalogOAuthError):
    code = "moy_nalog_provider_error"
    http_status = 502


class MoyNalogStoreUnavailable(MoyNalogOAuthError):
    code = "moy_nalog_store_unavailable"
    http_status = 503


@dataclass(frozen=True)
class OAuthReadiness:
    ready: bool
    missing: tuple[str, ...]


def _https(value: str | None) -> bool:
    return bool((value or "").strip().lower().startswith("https://"))


def _redirect_uri() -> str:
    configured = (settings.moy_nalog_redirect_uri or "").strip()
    if configured:
        return configured
    return f"{settings.public_base_url.rstrip('/')}/api/v1/fns/moy-nalog/oauth/callback"


def oauth_readiness() -> OAuthReadiness:
    missing: list[str] = []
    if not settings.moy_nalog_enabled:
        missing.append("MOY_NALOG_ENABLED")
    if not (settings.moy_nalog_client_id or "").strip():
        missing.append("MOY_NALOG_CLIENT_ID")
    if not (settings.moy_nalog_client_secret or "").strip():
        missing.append("MOY_NALOG_CLIENT_SECRET")
    if not _https(settings.moy_nalog_authorize_url):
        missing.append("MOY_NALOG_AUTHORIZE_URL_HTTPS")
    if not _https(settings.moy_nalog_token_url):
        missing.append("MOY_NALOG_TOKEN_URL_HTTPS")
    if not _https(_redirect_uri()):
        missing.append("MOY_NALOG_REDIRECT_URI_HTTPS")
    redis_url = (settings.redis_url or "").strip().lower()
    if not redis_url.startswith(("redis://", "rediss://")):
        missing.append("REDIS_URL")
    return OAuthReadiness(ready=not missing, missing=tuple(missing))


def oauth_ready() -> bool:
    return oauth_readiness().ready


def _redis_client():
    global _redis, _redis_failed
    readiness = oauth_readiness()
    if not readiness.ready:
        raise MoyNalogConfigurationError(
            "Интеграция «Мой налог» не настроена: " + ", ".join(readiness.missing)
        )
    if _redis_failed:
        raise MoyNalogStoreUnavailable("Хранилище OAuth временно недоступно")
    if _redis is not None:
        return _redis
    try:
        import redis

        _redis = redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
        )
        _redis.ping()
        return _redis
    except Exception as exc:
        _redis = None
        _redis_failed = True
        raise MoyNalogStoreUnavailable("Хранилище OAuth временно недоступно") from exc


def _state_key(state: str) -> str:
    digest = hashlib.sha256(state.encode("utf-8")).hexdigest()
    return f"renova:moy-nalog:state:{digest}"


def _token_key(user_id: str) -> str:
    return f"renova:moy-nalog:tokens:{user_id}"


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode("utf-8")).digest())
    return Fernet(key)


async def validate_runtime() -> None:
    """Fail startup when an enabled integration lacks durable state storage."""
    if not settings.moy_nalog_enabled:
        return
    readiness = oauth_readiness()
    if not readiness.ready:
        raise MoyNalogConfigurationError(
            "Интеграция «Мой налог» не настроена: " + ", ".join(readiness.missing)
        )
    await asyncio.to_thread(_redis_client)


async def create_oauth_state(user_id: str) -> str:
    if not user_id:
        raise MoyNalogStateError("Пользователь OAuth не определён")
    state = secrets.token_urlsafe(32)

    def store() -> None:
        client = _redis_client()
        stored = client.set(_state_key(state), user_id, nx=True, ex=_STATE_TTL)
        if not stored:
            raise MoyNalogStoreUnavailable("Не удалось сохранить OAuth state")

    await asyncio.to_thread(store)
    return state


async def consume_oauth_state(state: str, user_id: str) -> bool:
    if not state or not user_id:
        return False

    def consume() -> bool:
        client = _redis_client()
        result = client.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then "
            "redis.call('del', KEYS[1]); return 1 else return 0 end",
            1,
            _state_key(state),
            user_id,
        )
        return bool(result)

    try:
        return await asyncio.to_thread(consume)
    except MoyNalogOAuthError:
        raise
    except Exception as exc:
        raise MoyNalogStoreUnavailable("Не удалось проверить OAuth state") from exc


def build_authorize_url(state: str) -> str:
    readiness = oauth_readiness()
    if not readiness.ready:
        raise MoyNalogConfigurationError(
            "Интеграция «Мой налог» не настроена: " + ", ".join(readiness.missing)
        )
    if not state:
        raise MoyNalogStateError("OAuth state отсутствует")
    params = {
        "client_id": (settings.moy_nalog_client_id or "").strip(),
        "response_type": "code",
        "state": state,
        "redirect_uri": _redirect_uri(),
    }
    base = (settings.moy_nalog_authorize_url or "").strip()
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}{urlencode(params)}"


def _validate_token_payload(data: object) -> dict:
    if not isinstance(data, dict):
        raise MoyNalogProviderError("Token endpoint вернул ответ неизвестного формата")
    access_token = data.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise MoyNalogProviderError("Token endpoint не вернул access_token")
    token_type = data.get("token_type", "Bearer")
    if not isinstance(token_type, str) or token_type.lower() != "bearer":
        raise MoyNalogProviderError("Token endpoint вернул неподдерживаемый token_type")
    expires_in = data.get("expires_in")
    if type(expires_in) is not int or expires_in < _MIN_TOKEN_TTL or expires_in > _MAX_TOKEN_TTL:
        raise MoyNalogProviderError("Token endpoint вернул некорректный expires_in")
    refresh_token = data.get("refresh_token")
    if refresh_token is not None and (not isinstance(refresh_token, str) or not refresh_token.strip()):
        raise MoyNalogProviderError("Token endpoint вернул некорректный refresh_token")
    return {
        "access_token": access_token.strip(),
        "refresh_token": refresh_token.strip() if isinstance(refresh_token, str) else None,
        "token_type": "Bearer",
        "expires_in": expires_in,
        "scope": data.get("scope") if isinstance(data.get("scope"), str) else None,
    }


async def exchange_code_for_tokens(code: str) -> dict:
    readiness = oauth_readiness()
    if not readiness.ready:
        raise MoyNalogConfigurationError(
            "Интеграция «Мой налог» не настроена: " + ", ".join(readiness.missing)
        )
    code = (code or "").strip()
    if not code or len(code) > 4096:
        raise MoyNalogProviderError("Authorization code отсутствует или некорректен")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                (settings.moy_nalog_token_url or "").strip(),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": (settings.moy_nalog_client_id or "").strip(),
                    "client_secret": (settings.moy_nalog_client_secret or "").strip(),
                    "redirect_uri": _redirect_uri(),
                },
            )
    except (httpx.TimeoutException, httpx.NetworkError, httpx.RequestError) as exc:
        raise MoyNalogProviderError("Token endpoint временно недоступен") from exc
    if response.status_code < 200 or response.status_code >= 300:
        raise MoyNalogProviderError(f"Token endpoint отклонил запрос: HTTP {response.status_code}")
    try:
        data = response.json()
    except (ValueError, TypeError) as exc:
        raise MoyNalogProviderError("Token endpoint вернул некорректный JSON") from exc
    return _validate_token_payload(data)


async def store_tokens(user_id: str, tokens: dict) -> int:
    validated = _validate_token_payload(tokens)
    ttl = int(validated["expires_in"])
    plaintext = json.dumps(validated, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ciphertext = _fernet().encrypt(plaintext).decode("ascii")

    def store() -> None:
        client = _redis_client()
        client.setex(_token_key(user_id), ttl, ciphertext)

    try:
        await asyncio.to_thread(store)
    except MoyNalogOAuthError:
        raise
    except Exception as exc:
        raise MoyNalogStoreUnavailable("Не удалось сохранить OAuth tokens") from exc
    return ttl


async def connection_active(user_id: str) -> bool:
    def check() -> bool:
        client = _redis_client()
        value = client.get(_token_key(user_id))
        if not value:
            return False
        try:
            payload = json.loads(_fernet().decrypt(str(value).encode("ascii")).decode("utf-8"))
            _validate_token_payload(payload)
            return True
        except (InvalidToken, ValueError, TypeError, json.JSONDecodeError):
            client.delete(_token_key(user_id))
            return False

    try:
        return await asyncio.to_thread(check)
    except MoyNalogOAuthError:
        raise
    except Exception as exc:
        raise MoyNalogStoreUnavailable("Не удалось проверить OAuth connection") from exc


async def revoke_tokens(user_id: str) -> None:
    def revoke() -> None:
        _redis_client().delete(_token_key(user_id))

    try:
        await asyncio.to_thread(revoke)
    except MoyNalogOAuthError:
        raise
    except Exception as exc:
        raise MoyNalogStoreUnavailable("Не удалось отозвать OAuth tokens") from exc
