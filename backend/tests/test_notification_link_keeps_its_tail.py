"""Ссылка уведомления доносит обратный адрес целиком.

`_stored_link` вкладывает обратный адрес в ссылку. Одиннадцать мест на
бэкенде шлют обратный адрес со своим запросом — «вернуть в Ремонт, вкладка
Приёмка». Без кодирования получалось два «?» в одной строке:

    /stage/<id>?returnTo=/(customer)/(tabs)/repair?tab=control

Клиент режет ссылку по первому «?» и берёт следующий кусок — хвост после
второго «?» терялся. Человек приходил из уведомления в «Приёмку», жал
«Назад» и оказывался в «Этапах».

Отдельно: обратным адресом рассылался `/(role)/(tabs)/home` — маршрута с
таким именем не существует, главная это `/(role)/(tabs)/` со слешем.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app.services.notification_service import _stored_link

BACKEND = Path(__file__).resolve().parents[1]


def test_a_return_address_with_its_own_query_survives_intact():
    link = _stored_link("/stage/abc123", "/(customer)/(tabs)/repair?tab=control")

    assert link is not None
    assert link.count("?") == 1, f"два «?» в одной ссылке: {link}"

    parsed = urlparse(link)
    return_to = parse_qs(parsed.query)["returnTo"][0]
    assert return_to == "/(customer)/(tabs)/repair?tab=control", (
        "обратный адрес потерял свой запрос"
    )


def test_a_link_that_already_has_a_query_gets_an_ampersand():
    link = _stored_link("/chat/thread-1?highlightId=msg-9", "/(customer)/(tabs)/chat")

    assert link == "/chat/thread-1?highlightId=msg-9&returnTo=%2F%28customer%29%2F%28tabs%29%2Fchat"
    parsed = urlparse(link)
    params = parse_qs(parsed.query)
    assert params["highlightId"] == ["msg-9"], "исходный параметр ссылки потерялся"
    assert params["returnTo"] == ["/(customer)/(tabs)/chat"]


def test_nothing_is_added_when_there_is_no_return_address():
    assert _stored_link("/stage/abc", None) == "/stage/abc"
    assert _stored_link(None, "/(customer)/(tabs)/") is None


def test_the_backend_no_longer_sends_a_route_that_does_not_exist():
    """`(tabs)/home` — такого файла в app/ нет; главная это `(tabs)/`."""
    found = subprocess.run(
        ["grep", "-rn", "(tabs)/home", str(BACKEND / "app")],
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert found == "", f"обратный адрес снова ведёт на несуществующий маршрут:\n{found}"


def test_the_home_address_is_the_canonical_one():
    """Страховка: адрес главной не должен превратиться во что-то третье."""
    canonical = subprocess.run(
        ["grep", "-rho", r"/(customer)/(tabs)/\"", str(BACKEND / "app")],
        capture_output=True,
        text=True,
    ).stdout
    assert canonical.strip(), "бэкенд вообще перестал ссылаться на главную заказчика"
