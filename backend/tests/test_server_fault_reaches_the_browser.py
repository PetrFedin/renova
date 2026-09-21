"""Падение сервера должно выглядеть как падение сервера, а не как обрыв связи.

`ServerErrorMiddleware` в Starlette стоит снаружи всех наших middleware,
включая CORS. Необработанное исключение поднималось мимо CORS-слоя, и
ответ 500 уходил без `Access-Control-Allow-Origin`.

Браузер такой ответ до кода приложения не доносит: `fetch` падает
`TypeError: Failed to fetch` — тем же, чем падает выключенный сервер.
Клиент переводил это в «Сервер временно недоступен. Проверьте соединение
и повторите», и заказчик шёл перезагружать роутер, пока на сервере лежала
ручка.

Найдено на живом стенде: у `/os/budget` (падал с MissingGreenlet)
заголовка CORS не было, у соседней рабочей ручки — был.
"""
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.middleware.correlation import CorrelationIdMiddleware
from app.middleware.server_fault import FAULT_MESSAGE, ServerFaultMiddleware

ORIGIN = "http://localhost:8081"


def build_app() -> FastAPI:
    """Тот же порядок регистрации, что и в main: CORS снаружи, сбой внутри."""
    app = FastAPI()

    @app.get("/boom")
    async def boom():
        raise RuntimeError("что-то пошло не так внутри маршрута")

    @app.get("/fine")
    async def fine():
        return {"ok": True}

    app.add_middleware(ServerFaultMiddleware)
    app.add_middleware(CorrelationIdMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_headers=["*"], allow_methods=["*"])
    return app


@pytest.fixture()
def client():
    with TestClient(build_app(), raise_server_exceptions=False) as c:
        yield c


def test_crash_answers_500_and_not_a_dropped_connection(client):
    res = client.get("/boom", headers={"Origin": ORIGIN})
    assert res.status_code == 500


def test_crash_keeps_the_cors_header(client):
    res = client.get("/boom", headers={"Origin": ORIGIN})
    assert res.headers.get("access-control-allow-origin"), (
        "ответ 500 снова уходит без CORS — браузер покажет его как обрыв связи"
    )


def test_working_route_is_unchanged(client):
    # Проверка не должна проходить оттого, что сломалось всё.
    res = client.get("/fine", headers={"Origin": ORIGIN})
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert res.headers.get("access-control-allow-origin")


def test_body_says_it_is_the_server_not_the_network(client):
    body = client.get("/boom", headers={"Origin": ORIGIN}).json()
    assert body["detail"] == FAULT_MESSAGE
    assert body["code"] == "server_error"
    assert "сервер" in body["detail"].lower()
    # И ни слова про соединение: это было бы ровно прежней неправдой.
    assert "соединен" not in body["detail"].lower()


def test_body_carries_the_request_id_for_support(client):
    res = client.get("/boom", headers={"Origin": ORIGIN, "X-Request-Id": "req-42"})
    assert res.json().get("request_id") == "req-42"
    assert res.headers.get("X-Request-Id") == "req-42"


def test_internals_are_not_leaked(client):
    text = client.get("/boom", headers={"Origin": ORIGIN}).text
    assert "RuntimeError" not in text
    assert "что-то пошло не так внутри маршрута" not in text
    assert "Traceback" not in text


def test_the_crash_is_still_written_to_the_log(client, caplog):
    # Трассировку печатал ServerErrorMiddleware; потерять её было бы хуже
    # исходной беды.
    with caplog.at_level("ERROR", logger="app.server_fault"):
        client.get("/boom", headers={"Origin": ORIGIN})
    assert any("unhandled server fault" in r.message for r in caplog.records)
    assert any(r.exc_info for r in caplog.records), "трассировка не записана"


def test_handled_http_errors_are_untouched():
    from fastapi import HTTPException

    app = build_app()

    @app.get("/denied")
    async def denied():
        raise HTTPException(403, "contractor_only")

    with TestClient(app, raise_server_exceptions=False) as c:
        res = c.get("/denied", headers={"Origin": ORIGIN})
    assert res.status_code == 403
    assert res.json()["detail"] == "contractor_only"
