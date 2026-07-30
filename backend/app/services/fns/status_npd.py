"""Truthful status checks against the public FNS NPD API."""
from __future__ import annotations

from datetime import date
from typing import Any

import httpx

from app.core.config import settings

_MIN_NPD_DATE = date(2019, 1, 1)
_FNS_TIMEOUT_SECONDS = 65.0


class FnsNpdError(RuntimeError):
    code = "fns_npd_error"
    http_status = 502
    retryable = False

    def __init__(self, message: str, *, provider_code: str | None = None):
        super().__init__(message)
        self.provider_code = provider_code


class FnsNpdInvalidRequest(FnsNpdError):
    code = "fns_npd_invalid_request"
    http_status = 422


class FnsNpdRateLimited(FnsNpdError):
    code = "fns_npd_rate_limited"
    http_status = 429
    retryable = True


class FnsNpdUnavailable(FnsNpdError):
    code = "fns_npd_unavailable"
    http_status = 503
    retryable = True


class FnsNpdProtocolError(FnsNpdError):
    code = "fns_npd_protocol_error"
    http_status = 502


def normalize_inn(inn: str) -> str:
    value = (inn or "").strip()
    if len(value) != 12 or not value.isascii() or not value.isdigit():
        raise FnsNpdInvalidRequest("ИНН физического лица должен содержать 12 цифр")
    return value


def normalize_request_date(on_date: date | None) -> date:
    value = on_date or date.today()
    if value < _MIN_NPD_DATE:
        raise FnsNpdInvalidRequest("Дата проверки не может быть раньше 01.01.2019")
    if value > date.today():
        raise FnsNpdInvalidRequest("Дата проверки не может быть позже текущего дня")
    return value


def _json_object(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except (ValueError, TypeError) as exc:
        raise FnsNpdProtocolError("ФНС вернула некорректный JSON") from exc
    if not isinstance(data, dict):
        raise FnsNpdProtocolError("ФНС вернула ответ неизвестного формата")
    return data


def _message(data: dict[str, Any], default: str) -> str:
    value = data.get("message")
    return value.strip() if isinstance(value, str) and value.strip() else default


def _raise_provider_error(response: httpx.Response) -> None:
    if response.status_code in {408, 425, 429} or response.status_code >= 500:
        raise FnsNpdUnavailable("Сервис ФНС временно недоступен")
    if response.status_code == 400:
        raise FnsNpdInvalidRequest("Некорректный формат запроса ФНС")
    if response.status_code == 422:
        data = _json_object(response)
        provider_code = data.get("code") if isinstance(data.get("code"), str) else None
        message = _message(data, "ФНС отклонила запрос")
        if provider_code == "validation.failed":
            raise FnsNpdInvalidRequest(message, provider_code=provider_code)
        if provider_code == "taxpayer.status.service.limited.error":
            raise FnsNpdRateLimited(message, provider_code=provider_code)
        if provider_code == "taxpayer.status.service.unavailable.error":
            raise FnsNpdUnavailable(message, provider_code=provider_code)
        raise FnsNpdProtocolError(message, provider_code=provider_code)
    if response.status_code in {401, 403}:
        raise FnsNpdProtocolError("ФНС отклонила доступ к публичному сервису")
    raise FnsNpdProtocolError(f"ФНС вернула HTTP {response.status_code}")


async def check_taxpayer_npd_status(inn: str, on_date: date | None = None) -> dict:
    """Check NPD status without coercing unknown provider values to truth."""
    canonical_inn = normalize_inn(inn)
    request_date = normalize_request_date(on_date)
    url = (settings.fns_npd_status_url or "").strip()
    if not url.lower().startswith("https://"):
        raise FnsNpdUnavailable("URL публичного сервиса ФНС не настроен")

    try:
        async with httpx.AsyncClient(timeout=_FNS_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                json={"inn": canonical_inn, "requestDate": request_date.isoformat()},
            )
    except (httpx.TimeoutException, httpx.NetworkError, httpx.RequestError) as exc:
        raise FnsNpdUnavailable("Сервис ФНС временно недоступен") from exc

    if response.status_code != 200:
        _raise_provider_error(response)

    data = _json_object(response)
    provider_status = data.get("status")
    if type(provider_status) is not bool:
        raise FnsNpdProtocolError("ФНС вернула поле status не типа Boolean")
    message = data.get("message")
    if not isinstance(message, str):
        raise FnsNpdProtocolError("ФНС вернула поле message неизвестного типа")

    return {
        "inn": canonical_inn,
        "request_date": request_date.isoformat(),
        "is_npd": provider_status,
        "message": message.strip(),
        "verified_live": True,
    }
