"""Ненужный этап можно пропустить, а пустой — удалить.

Этап можно было создать, запустить, сдать и принять — но нельзя ни удалить,
ни пропустить. Часть типового набора конкретному объекту не нужна: если полы
не трогают, «Стяжка» висит вечно на нуле и тянет прогресс проекта вниз.

Главное действие — пропуск, а не удаление: на этап ссылаются двенадцать
таблиц, и удаление в общем случае означало бы потерю оплат, фото, приёмок и
расходов. Удаление оставлено только там, где оно безопасно — когда к этапу не
привязано ничего.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "skip.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _project_with_stages(client, headers):
    created = await client.post(
        "/api/v1/projects",
        headers=headers,
        json={"name": "Объект", "rooms": [{"name": "Кухня", "length_m": 4, "width_m": 3}]},
    )
    assert created.status_code in (200, 201), created.text
    project_id = created.json()["id"]
    plan = (await client.get(f"/api/v1/projects/{project_id}/plan", headers=headers)).json()
    stages = plan if isinstance(plan, list) else plan.get("stages", [])
    assert stages, f"проект создан без этапов: {plan}"
    return project_id, stages


async def _progress(client, headers, project_id: str) -> float:
    """Живой прогресс проекта.

    Берётся с `/dashboard`, а не с `GET /projects/{id}`: второй отдаёт
    `progress_percent` из колонки `projects.progress_percent`, которую не
    пишет ничто, кроме демо-сидера. Это отдельный дефект, он чинится своей
    правкой; здесь нужен источник, который действительно считает.
    """
    dashboard = (
        await client.get(f"/api/v1/projects/{project_id}/dashboard", headers=headers)
    ).json()
    return float(dashboard.get("progress_percent") or 0)


async def test_a_stage_the_project_does_not_need_can_be_skipped():
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, stages = await _project_with_stages(client, headers)
        target = stages[0]["id"]

        skipped = await client.post(
            f"/api/v1/projects/{project_id}/stages/{target}/skip",
            headers=headers,
            json={"reason": "Полы не трогаем"},
        )
        assert skipped.status_code == 200, skipped.text
        body = skipped.json()
        assert body["skipped_at"], "этап не помечен пропущенным"
        assert body["skipped_reason"] == "Полы не трогаем"


async def test_skipping_does_not_delete_anything():
    """Страховка: пропуск — не удаление. Этап остаётся в плане."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, stages = await _project_with_stages(client, headers)
        target = stages[0]["id"]
        before = len(stages)

        await client.post(
            f"/api/v1/projects/{project_id}/stages/{target}/skip", headers=headers, json={}
        )

        plan = (await client.get(f"/api/v1/projects/{project_id}/plan", headers=headers)).json()
        after = plan if isinstance(plan, list) else plan.get("stages", [])
        assert len(after) == before, "пропуск удалил этап вместо того, чтобы пометить"
        assert any(item["id"] == target for item in after), "пропущенный этап исчез из плана"


async def test_a_skipped_stage_stops_dragging_progress_down():
    """Ради этого пропуск и нужен.

    Один этап доведён до 100%, остальные объекту не нужны. Пока они считаются,
    прогресс проекта — доля одного этапа из всех. После пропуска остаётся
    только сделанный, и проект честно показывает 100%.

    Числа здесь обязаны различаться: проверка вида «стало не меньше» была бы
    верна и при нуле, то есть не проверяла бы ничего.
    """
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, stages = await _project_with_stages(client, headers)
        assert len(stages) >= 2, "для проверки нужен не один этап"

        from app.db import session as sess
        from app.models.entities import Stage

        async with sess.SessionLocal() as db:
            done = await db.get(Stage, stages[0]["id"])
            done.percent_complete = 100
            await db.commit()

        before = await _progress(client, headers, project_id)
        assert 0 < before < 100, (
            f"стенд собран неверно: прогресс {before} не показывает частичную готовность"
        )

        for stage in stages[1:]:
            skipped = await client.post(
                f"/api/v1/projects/{project_id}/stages/{stage['id']}/skip",
                headers=headers,
                json={"reason": "Этих работ на объекте нет"},
            )
            assert skipped.status_code == 200, skipped.text

        after = await _progress(client, headers, project_id)
        assert after == 100, (
            f"пропущенные этапы всё ещё тянут прогресс вниз: было {before}, стало {after}"
        )


async def test_a_skipped_stage_comes_back():
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, stages = await _project_with_stages(client, headers)
        target = stages[0]["id"]

        await client.post(
            f"/api/v1/projects/{project_id}/stages/{target}/skip", headers=headers, json={}
        )
        back = await client.post(
            f"/api/v1/projects/{project_id}/stages/{target}/unskip", headers=headers
        )
        assert back.status_code == 200, back.text
        assert back.json()["skipped_at"] is None


async def test_an_empty_stage_can_be_deleted():
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, stages = await _project_with_stages(client, headers)
        target = stages[-1]["id"]
        before = len(stages)

        removed = await client.delete(
            f"/api/v1/projects/{project_id}/stages/{target}", headers=headers
        )
        assert removed.status_code == 200, removed.text

        plan = (await client.get(f"/api/v1/projects/{project_id}/plan", headers=headers)).json()
        after = plan if isinstance(plan, list) else plan.get("stages", [])
        assert len(after) == before - 1
        assert not any(item["id"] == target for item in after)


async def test_a_stage_with_a_payment_is_not_deleted_silently():
    """Главная страховка: удаление не должно уносить с собой оплату."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, stages = await _project_with_stages(client, headers)
        target = stages[0]["id"]

        # Счёт сажаем напрямую: правила создания оплат тут ни при чём,
        # предмет проверки — что привязанная оплата не даёт удалить этап.
        from app.db import session as sess
        from app.models.entities import Payment, PaymentStatus, PaymentType

        async with sess.SessionLocal() as db:
            db.add(
                Payment(
                    project_id=project_id,
                    stage_id=target,
                    title="Оплата этапа",
                    amount=5000,
                    payment_type=PaymentType.stage,
                    status=PaymentStatus.pending,
                    created_by=user["id"],
                )
            )
            await db.commit()

        refused = await client.delete(
            f"/api/v1/projects/{project_id}/stages/{target}", headers=headers
        )
        assert refused.status_code == 409, refused.text
        detail = refused.json()["detail"]
        assert detail["code"] == "stage_has_attachments"
        assert any(hold["label"] == "оплаты" for hold in detail["holds"]), detail
        assert "пропустить" in detail["message"], "отказ не подсказывает, что делать вместо"

        # ...и этап на месте.
        plan = (await client.get(f"/api/v1/projects/{project_id}/plan", headers=headers)).json()
        after = plan if isinstance(plan, list) else plan.get("stages", [])
        assert any(item["id"] == target for item in after), "этап удалён вопреки отказу"


async def test_a_finished_stage_is_not_skipped():
    """Сданный этап пропускать нечего — работа уже принята."""
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_id, stages = await _project_with_stages(client, headers)
        target = stages[0]["id"]

        from app.db import session as sess
        from app.models.entities import Stage, StageStatus

        async with sess.SessionLocal() as db:
            stage = await db.get(Stage, target)
            stage.status = StageStatus.done
            await db.commit()

        refused = await client.post(
            f"/api/v1/projects/{project_id}/stages/{target}/skip", headers=headers, json={}
        )
        assert refused.status_code == 409, refused.text


async def test_a_stage_of_another_project_is_refused():
    async with _client() as client:
        user = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        headers = {"X-User-Id": user["id"]}
        project_a, _stages_a = await _project_with_stages(client, headers)
        _project_b, stages_b = await _project_with_stages(client, headers)

        refused = await client.post(
            f"/api/v1/projects/{project_a}/stages/{stages_b[0]['id']}/skip",
            headers=headers,
            json={},
        )
        assert refused.status_code == 404, refused.text
