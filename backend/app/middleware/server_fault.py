"""Падение сервера должно выглядеть как падение сервера, а не как обрыв связи.

`ServerErrorMiddleware` в Starlette стоит снаружи всех наших middleware,
включая CORS. Поэтому необработанное исключение поднималось мимо
CORS-слоя, и ответ 500 уходил **без** `Access-Control-Allow-Origin`.

Браузер такой ответ до кода приложения не доносит: `fetch` падает
`TypeError: Failed to fetch` — ровно тем же, чем падает выключенный
сервер или пропавший Wi-Fi. Клиент это добросовестно переводил в
«Сервер временно недоступен. Проверьте соединение и повторите», и
заказчик шёл перезагружать роутер, пока на сервере лежала ручка.

Проверено на стенде:

    GET …/work-orders  → 200, access-control-allow-origin: *
    GET …/os/budget    → 500, заголовка нет

Middleware ловит исключение внутри CORS-слоя и отдаёт обычный ответ
500. Дальше он проходит наружу через `CorrelationIdMiddleware` и
`CORSMiddleware` как любой другой — с `X-Request-Id` и заголовками CORS.
Браузер доносит его до кода, и клиент уже может сказать правду.

Трассировку по-прежнему пишем: раньше её печатал `ServerErrorMiddleware`,
теперь печатаем сами — потерять её было бы хуже исходной беды.
"""
from __future__ import annotations

import logging

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.middleware.correlation import current_correlation_id

logger = logging.getLogger("app.server_fault")

#: Что видит пользователь. Без подробностей: внутренности наружу не выносим.
FAULT_MESSAGE = "Сбой на сервере. Мы записали ошибку — попробуйте ещё раз."


class ServerFaultMiddleware(BaseHTTPMiddleware):
    """Превращает необработанное исключение в честный ответ 500."""

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            # `BaseException` не трогаем: отмена задачи и уход клиента — не сбой
            # сервера, и подменять их ответом 500 нельзя.
            correlation_id = current_correlation_id()
            logger.exception(
                "unhandled server fault: %s %s (request_id=%s)",
                request.method,
                request.url.path,
                correlation_id,
            )
            body: dict[str, str] = {"detail": FAULT_MESSAGE, "code": "server_error"}
            if correlation_id:
                # Чтобы поддержка нашла ровно эту строку в журнале.
                body["request_id"] = correlation_id
            return JSONResponse(status_code=500, content=body)
