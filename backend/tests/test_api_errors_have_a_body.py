"""Ошибка API обязана нести код и человеческий текст.

``raise HTTPException(404)`` без detail даёт ``{"detail": "Not Found"}``:
пользователь видит английскую строку, а приложению нечем её заменить —
кода в ответе нет. Здесь два рубежа: статический по исходникам и живой
по реальному ответу маршрута.
"""
import ast
import pathlib

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.errors import forbidden, not_found
from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

API_ROOT = pathlib.Path(__file__).resolve().parents[1] / "app" / "api"
_STATUSES_NEEDING_A_BODY = {400, 403, 404, 409}


def _bare_raises(path: pathlib.Path) -> list[int]:
    """Строки, где HTTPException(4xx) поднимается без detail."""
    tree = ast.parse(path.read_text())
    found: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        if name != "HTTPException":
            continue
        if any(kw.arg == "detail" for kw in node.keywords):
            continue
        if len(node.args) >= 2:
            continue
        if not node.args:
            continue
        status = node.args[0]
        if isinstance(status, ast.Constant) and status.value in _STATUSES_NEEDING_A_BODY:
            found.append(node.lineno)
    return found


def test_no_route_raises_a_status_without_a_body():
    offenders: list[str] = []
    for path in sorted(API_ROOT.rglob("*.py")):
        for lineno in _bare_raises(path):
            offenders.append(f"{path.relative_to(API_ROOT.parent.parent)}:{lineno}")
    assert offenders == [], (
        "эти места отдадут пользователю английское «Not Found» без кода: "
        + ", ".join(offenders)
    )


def test_helpers_refuse_an_unknown_key():
    """Опечатка в сущности должна падать сразу, а не отдавать пустой текст."""
    with pytest.raises(KeyError):
        not_found("совершенно_неизвестная_сущность")
    with pytest.raises(KeyError):
        forbidden("совершенно_неизвестная_причина")


def test_every_message_is_russian_and_non_empty():
    from app.api.errors import _FORBIDDEN, _NOT_FOUND

    for key, message in {**_NOT_FOUND, **_FORBIDDEN}.items():
        assert message.strip(), f"пустой текст для {key}"
        assert any("а" <= ch.lower() <= "я" for ch in message), (
            f"текст для {key} не на русском: {message}"
        )


@pytest.fixture
async def client(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path}/api_errors.db"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess
    import sqlalchemy.ext.asyncio as sa

    sess.engine = sa.create_async_engine(url, echo=False)
    sess.SessionLocal = sa.async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


@pytest.mark.asyncio
async def test_missing_issue_answers_in_russian_with_a_code(client):
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    headers = {"X-User-Id": customer["id"]}
    project_id = (await client.get("/api/v1/projects", headers=headers)).json()[0]["id"]

    response = await client.post(
        f"/api/v1/projects/{project_id}/issues/no-such-issue/transition",
        headers=headers,
        json={"status": "closed"},
    )

    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail == {"code": "issue_not_found", "message": "Замечание не найдено"}
