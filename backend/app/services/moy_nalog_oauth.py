"""Fail-closed OAuth state and token storage for «Мой налог».

The provider refresh grant is intentionally not implemented here until a
supported provider contract is available. A returned refresh token may be kept
encrypted beyond access-token expiry as a local recovery credential, but its
presence is never treated as proof that the provider will accept it.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.timeutil import utc_now

_STATE_TTL = 600
_MIN_TOKEN_TTL = 60
_MAX_TOKEN_TTL = 60 * 60 * 24 * 30
_TOKEN_ENVELOPE_VERSION = 2
_WORKING_ENVIRONMENTS = {"staging", "production"}
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


class _TokenEncryptionKeyUnavailable(RuntimeError):
    pass


class _TokenRecordCorrupt(RuntimeError):
    pass


@dataclass(frozen=True)
class OAuthReadiness:
    ready: bool
    missing: tuple[str, ...]


@dataclass(frozen=True)
class TokenConnectionState:
    status: str
    active: bool
    expires_at: str | None
    expires_in_seconds: int | None
    refresh_token_retained: bool
    encryption_key_id: str | None
    legacy_encryption: bool = False

    def public_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "active": self.active,
            "expires_at": self.expires_at,
            "expires_in_seconds": self.expires_in_seconds,
            "refresh_token_retained": self.refresh_token_retained,
        }


@dataclass(frozen=True)
class _EncryptionKey:
    key_id: str
    fernet: Fernet


def _https(value: str | None) -> bool:
    return bool((value or "").strip().lower().startswith("https://"))


def _redirect_uri() -> str:
    configured = (settings.moy_nalog_redirect_uri or "").strip()
    if configured:
        return configured
    return f"{settings.public_base_url.rstrip('/')}/api/v1/fns/moy-nalog/oauth/callback"


def _raw_encryption_secrets() -> list[str]:
    return [part.strip() for part in (settings.moy_nalog_token_encryption_keys or "").split(",") if part.strip()]


def _deduplicated_encryption_secrets() -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for secret in _raw_encryption_secrets():
        if secret in seen:
            continue
        seen.add(secret)
        result.append(secret)
    return result


def _key_id(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]


def _encryption_key(secret: str) -> _EncryptionKey:
    material = hashlib.sha256(secret.encode("utf-8")).digest()
    return _EncryptionKey(
        key_id=_key_id(secret),
        fernet=Fernet(base64.urlsafe_b64encode(material)),
    )


def _configured_encryption_keys() -> list[_EncryptionKey]:
    return [_encryption_key(secret) for secret in _deduplicated_encryption_secrets()]


def _active_encryption_keys() -> list[_EncryptionKey]:
    configured = _configured_encryption_keys()
    if configured:
        return configured
    # Local/test compatibility only. Working environments require the dedicated
    # keyring in oauth_readiness and therefore never write new tokens with the
    # general application signing secret.
    return [_encryption_key(settings.secret_key)]


def _legacy_decryption_keys() -> list[_EncryptionKey]:
    """Keys allowed only to migrate the pre-envelope SECRET_KEY ciphertext."""
    keys = _active_encryption_keys()
    shared = _encryption_key(settings.secret_key)
    if all(item.key_id != shared.key_id for item in keys):
        keys.append(shared)
    return keys


def _primary_encryption_key() -> _EncryptionKey:
    return _active_encryption_keys()[0]


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

    raw_keys = _raw_encryption_secrets()
    unique_keys = _deduplicated_encryption_secrets()
    if settings.normalized_environment in _WORKING_ENVIRONMENTS and not unique_keys:
        missing.append("MOY_NALOG_TOKEN_ENCRYPTION_KEYS")
    if raw_keys and len(raw_keys) != len(unique_keys):
        missing.append("MOY_NALOG_TOKEN_ENCRYPTION_KEYS_UNIQUE")
    if any(len(secret.encode("utf-8")) < 32 for secret in unique_keys):
        missing.append("MOY_NALOG_TOKEN_ENCRYPTION_KEYS_MIN_32_BYTES")
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


def _iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat() + "Z"


def _parse_iso(value: object) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise _TokenRecordCorrupt("invalid timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1])
    except ValueError as exc:
        raise _TokenRecordCorrupt("invalid timestamp") from exc
    if parsed.tzinfo is not None:
        parsed = parsed.replace(tzinfo=None)
    return parsed


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


def _token_record(validated: dict, *, now: datetime, access_ttl: int | None = None) -> dict:
    ttl = int(access_ttl if access_ttl is not None else validated["expires_in"])
    return {
        "version": _TOKEN_ENVELOPE_VERSION,
        "tokens": validated,
        "stored_at": _iso(now),
        "access_expires_at": _iso(now + timedelta(seconds=max(0, ttl))),
    }


def _validate_record(data: object) -> dict:
    if not isinstance(data, dict) or data.get("version") != _TOKEN_ENVELOPE_VERSION:
        raise _TokenRecordCorrupt("unsupported token record")
    try:
        tokens = _validate_token_payload(data.get("tokens"))
    except MoyNalogProviderError as exc:
        raise _TokenRecordCorrupt("invalid token payload") from exc
    stored_at = _parse_iso(data.get("stored_at"))
    access_expires_at = _parse_iso(data.get("access_expires_at"))
    if access_expires_at < stored_at:
        raise _TokenRecordCorrupt("invalid expiry ordering")
    return {
        "version": _TOKEN_ENVELOPE_VERSION,
        "tokens": tokens,
        "stored_at": stored_at,
        "access_expires_at": access_expires_at,
    }


def _encode_record(record: dict) -> tuple[str, str]:
    primary = _primary_encryption_key()
    serializable = {
        "version": _TOKEN_ENVELOPE_VERSION,
        "tokens": record["tokens"],
        "stored_at": _iso(record["stored_at"]) if isinstance(record["stored_at"], datetime) else record["stored_at"],
        "access_expires_at": _iso(record["access_expires_at"]) if isinstance(record["access_expires_at"], datetime) else record["access_expires_at"],
    }
    plaintext = json.dumps(serializable, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ciphertext = primary.fernet.encrypt(plaintext).decode("ascii")
    envelope = json.dumps(
        {
            "version": _TOKEN_ENVELOPE_VERSION,
            "key_id": primary.key_id,
            "ciphertext": ciphertext,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return envelope, primary.key_id


def _redis_ttl(client, key: str) -> int | None:
    ttl_method = getattr(client, "ttl", None)
    if not callable(ttl_method):
        return None
    try:
        value = int(ttl_method(key))
    except Exception:
        return None
    return value if value > 0 else None


def _decode_record(client, key: str, stored_value: str) -> tuple[dict, str | None, bool]:
    """Decode v2 envelope or migrate a legacy raw Fernet ciphertext in-place."""
    try:
        envelope = json.loads(stored_value)
    except (TypeError, ValueError, json.JSONDecodeError):
        envelope = None

    if isinstance(envelope, dict) and envelope.get("version") == _TOKEN_ENVELOPE_VERSION:
        key_id = envelope.get("key_id")
        ciphertext = envelope.get("ciphertext")
        if not isinstance(key_id, str) or not isinstance(ciphertext, str):
            raise _TokenRecordCorrupt("invalid token envelope")
        encryption_key = next((item for item in _active_encryption_keys() if item.key_id == key_id), None)
        if encryption_key is None:
            raise _TokenEncryptionKeyUnavailable("token encryption key unavailable")
        try:
            plaintext = encryption_key.fernet.decrypt(ciphertext.encode("ascii"))
            record = _validate_record(json.loads(plaintext.decode("utf-8")))
        except (InvalidToken, UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError) as exc:
            raise _TokenRecordCorrupt("invalid encrypted token record") from exc
        return record, key_id, False

    # Pre-v2 rows were a raw Fernet token generated from SECRET_KEY. A syntactic
    # Fernet token that cannot be decrypted is retained: removing it could erase
    # a recoverable connection merely because a previous key is temporarily
    # missing from the rotation keyring.
    if not isinstance(stored_value, str) or not stored_value.startswith("gAAAA"):
        raise _TokenRecordCorrupt("invalid legacy token record")
    for candidate in _legacy_decryption_keys():
        try:
            plaintext = candidate.fernet.decrypt(stored_value.encode("ascii"))
            validated = _validate_token_payload(json.loads(plaintext.decode("utf-8")))
        except (InvalidToken, UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError, MoyNalogProviderError):
            continue
        remaining = _redis_ttl(client, key)
        if remaining is None:
            remaining = int(validated["expires_in"])
        remaining = max(1, min(int(validated["expires_in"]), remaining))
        record = _validate_record(_token_record(validated, now=utc_now(), access_ttl=remaining))
        migrated_value, primary_id = _encode_record(record)
        storage_ttl = remaining
        if validated.get("refresh_token"):
            storage_ttl += int(settings.moy_nalog_token_recovery_retention_days) * 86400
        client.setex(key, storage_ttl, migrated_value)
        return record, primary_id, True
    raise _TokenEncryptionKeyUnavailable("legacy token encryption key unavailable")


def _storage_ttl(validated: dict) -> int:
    ttl = int(validated["expires_in"])
    if validated.get("refresh_token"):
        ttl += int(settings.moy_nalog_token_recovery_retention_days) * 86400
    return ttl


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
    access_ttl = int(validated["expires_in"])
    record = _validate_record(_token_record(validated, now=utc_now()))
    stored_value, _key_id_value = _encode_record(record)
    storage_ttl = _storage_ttl(validated)

    def store() -> None:
        client = _redis_client()
        client.setex(_token_key(user_id), storage_ttl, stored_value)

    try:
        await asyncio.to_thread(store)
    except MoyNalogOAuthError:
        raise
    except Exception as exc:
        raise MoyNalogStoreUnavailable("Не удалось сохранить OAuth tokens") from exc
    # Preserve the public contract: callers receive provider access lifetime,
    # not the longer local encrypted recovery-retention period.
    return access_ttl


async def connection_state(user_id: str) -> TokenConnectionState:
    def inspect() -> TokenConnectionState:
        client = _redis_client()
        key = _token_key(user_id)
        value = client.get(key)
        if not value:
            return TokenConnectionState(
                status="not_connected",
                active=False,
                expires_at=None,
                expires_in_seconds=None,
                refresh_token_retained=False,
                encryption_key_id=None,
            )
        try:
            record, key_id, legacy = _decode_record(client, key, str(value))
        except _TokenEncryptionKeyUnavailable:
            return TokenConnectionState(
                status="encryption_key_unavailable",
                active=False,
                expires_at=None,
                expires_in_seconds=None,
                refresh_token_retained=False,
                encryption_key_id=None,
            )
        except _TokenRecordCorrupt:
            client.delete(key)
            return TokenConnectionState(
                status="reconnect_required",
                active=False,
                expires_at=None,
                expires_in_seconds=None,
                refresh_token_retained=False,
                encryption_key_id=None,
            )

        now = utc_now()
        expires_at = record["access_expires_at"]
        remaining = max(0, int((expires_at - now).total_seconds()))
        refresh_retained = bool(record["tokens"].get("refresh_token"))
        if remaining > int(settings.moy_nalog_token_expiring_threshold_sec):
            status = "active"
            active = True
        elif remaining > 0:
            status = "expiring"
            active = True
        elif refresh_retained:
            status = "expired_refresh_token_retained"
            active = False
        else:
            client.delete(key)
            status = "reconnect_required"
            active = False
        return TokenConnectionState(
            status=status,
            active=active,
            expires_at=_iso(expires_at),
            expires_in_seconds=remaining,
            refresh_token_retained=refresh_retained,
            encryption_key_id=key_id,
            legacy_encryption=legacy,
        )

    try:
        return await asyncio.to_thread(inspect)
    except MoyNalogOAuthError:
        raise
    except Exception as exc:
        raise MoyNalogStoreUnavailable("Не удалось проверить OAuth connection") from exc


async def connection_active(user_id: str) -> bool:
    return (await connection_state(user_id)).active


async def runtime_health() -> dict[str, object]:
    """Safe operator-facing configuration/store health without token material."""
    readiness = oauth_readiness()
    explicit_keys = _configured_encryption_keys()
    enabled = bool(settings.moy_nalog_enabled)
    result: dict[str, object] = {
        "enabled": enabled,
        "configured": readiness.ready,
        "healthy": False,
        "status": "off" if not enabled else "critical",
        "missing": list(readiness.missing),
        "store_reachable": None,
        "dedicated_encryption_key_configured": bool(explicit_keys),
        "encryption_key_count": len(explicit_keys),
        "primary_key_id": explicit_keys[0].key_id if explicit_keys else None,
        "shared_secret_fallback": enabled and not explicit_keys,
        "recovery_retention_days": int(settings.moy_nalog_token_recovery_retention_days),
        "automatic_refresh_supported": False,
    }
    if not enabled:
        return result
    if not readiness.ready:
        return result
    try:
        client = await asyncio.to_thread(_redis_client)
        reachable = bool(await asyncio.to_thread(client.ping))
    except Exception:
        result["store_reachable"] = False
        return result
    result["store_reachable"] = reachable
    result["healthy"] = reachable
    result["status"] = "healthy" if reachable else "critical"
    return result


async def revoke_tokens(user_id: str) -> None:
    def revoke() -> None:
        _redis_client().delete(_token_key(user_id))

    try:
        await asyncio.to_thread(revoke)
    except MoyNalogOAuthError:
        raise
    except Exception as exc:
        raise MoyNalogStoreUnavailable("Не удалось отозвать OAuth tokens") from exc
