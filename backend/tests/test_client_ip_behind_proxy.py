"""Адрес клиента за прокси: от него зависят лимит частоты и белый список вебхуков."""
import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.environment import collect_warnings
from app.core.request_auth import rate_limit_key


def _app():
    async def whoami(request: Request):
        return JSONResponse(
            {
                "host": request.client.host if request.client else None,
                "identity": rate_limit_key(
                    authorization=None,
                    x_user_id=None,
                    client_host=request.client.host if request.client else None,
                ),
            }
        )

    return Starlette(routes=[Route("/whoami", whoami)])


def test_without_trusted_proxy_header_is_ignored():
    """Заголовок подделывается кем угодно: без доверия прокси его нельзя слушать."""
    app = ProxyHeadersMiddleware(_app(), trusted_hosts="127.0.0.1")
    with TestClient(app, client=("10.9.9.9", 1234)) as client:
        body = client.get("/whoami", headers={"X-Forwarded-For": "203.0.113.7"}).json()
    assert body["host"] == "10.9.9.9"
    assert body["identity"] == "10.9.9.9"


def test_trusted_proxy_reveals_the_real_client():
    app = ProxyHeadersMiddleware(_app(), trusted_hosts="10.0.0.1")
    with TestClient(app, client=("10.0.0.1", 1234)) as client:
        body = client.get("/whoami", headers={"X-Forwarded-For": "203.0.113.7"}).json()
    assert body["host"] == "203.0.113.7"
    assert body["identity"] == "203.0.113.7"


def test_two_clients_behind_one_proxy_get_separate_identities():
    """Иначе все люди за балансировщиком делят одно ведро лимита."""
    app = ProxyHeadersMiddleware(_app(), trusted_hosts="10.0.0.1")
    with TestClient(app, client=("10.0.0.1", 1234)) as client:
        first = client.get("/whoami", headers={"X-Forwarded-For": "203.0.113.7"}).json()
        second = client.get("/whoami", headers={"X-Forwarded-For": "198.51.100.4"}).json()
    assert first["identity"] != second["identity"]


def test_untrusted_proxy_collapses_clients_as_before():
    """Поведение по умолчанию: без настройки адрес у всех один — адрес прокси."""
    app = ProxyHeadersMiddleware(_app(), trusted_hosts="127.0.0.1")
    with TestClient(app, client=("10.0.0.1", 1234)) as client:
        first = client.get("/whoami", headers={"X-Forwarded-For": "203.0.113.7"}).json()
        second = client.get("/whoami", headers={"X-Forwarded-For": "198.51.100.4"}).json()
    assert first["identity"] == second["identity"] == "10.0.0.1"


def test_anonymous_identity_falls_back_to_address():
    """Без авторизации ключ — адрес, поэтому он и должен быть настоящим."""
    assert rate_limit_key(authorization=None, x_user_id=None, client_host="1.2.3.4") == "1.2.3.4"
    assert rate_limit_key(authorization=None, x_user_id=None, client_host=None) == "anon"


@pytest.mark.parametrize(
    "value,expected_fragment",
    [(None, "не задан"), ("", "не задан"), ("*", "подделать")],
)
def test_production_warns_about_forwarding_policy(value, expected_fragment):
    warnings = collect_warnings(
        environment="production",
        database_url="postgresql+asyncpg://u:p@db/renova",
        secret_key="s" * 32,
        forwarded_allow_ips=value,
    )
    assert any(expected_fragment in w for w in warnings), warnings


def test_configured_proxy_list_does_not_warn():
    warnings = collect_warnings(
        environment="production",
        database_url="postgresql+asyncpg://u:p@db/renova",
        secret_key="s" * 32,
        forwarded_allow_ips="10.0.0.0/8",
    )
    assert not any("FORWARDED_ALLOW_IPS" in w for w in warnings), warnings
