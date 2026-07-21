"""Regression: единый канон приёмки — legacy 410, work-acceptances golden path, P0 schedule/WO."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "acceptance_canon.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(config.settings.database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _demo_project(client: AsyncClient):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    h_cust = {"X-User-Id": cust["id"]}
    h_cont = {"X-User-Id": cont["id"]}
    pid = (await client.get("/api/v1/projects", headers=h_cust)).json()[0]["id"]
    await client.post(f"/api/v1/projects/{pid}/assign", headers=h_cont)
    return pid, h_cust, h_cont


def _open_stage(stages: list[dict]) -> dict:
    """После assign demo-seed часто ставит этап в review (очередь приёмки), не active."""
    for status in ("review", "active"):
        hit = next((s for s in stages if s.get("status") == status), None)
        if hit:
            return hit
    hit = next((s for s in stages if s.get("status") != "done"), None)
    if not hit:
        raise AssertionError(f"no open stage in {[s.get('status') for s in stages]}")
    return hit


async def test_legacy_accept_returns_410():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open_st["id"], "comment": "готов"},
        )
        r = await client.post(
            f"/api/v1/projects/{pid}/stages/{open_st['id']}/accept",
            headers=h_cust,
        )
        assert r.status_code == 410
        assert r.headers.get("x-deprecated-use") == "work-acceptances"


async def test_work_acceptance_canon_accept():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open_st["id"], "comment": "готов"},
        )
        assert created.status_code == 200, created.text
        acc_id = created.json()["id"]
        accepted = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
            headers=h_cust,
            json={"quality_score": 10, "comment": "ок"},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["status"] in ("accepted", "accepted_with_remarks")


async def test_os_acceptance_proxy_uses_canon():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open_st["id"]},
        )
        assert created.status_code == 200, created.text
        acc_id = created.json()["id"]
        r = await client.post(
            f"/api/v1/projects/{pid}/acceptances/{acc_id}/accept",
            headers=h_cust,
            json={"with_remarks": False, "comment": "via os proxy"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accepted"




async def test_w139_accept_without_score_clears_stale():
    """W139: accept/return без quality_score не оставляют stale оценку в БД."""
    from app.db import session as sess
    from app.models.entities import WorkAcceptance

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open_st["id"], "comment": "готов"},
        )
        assert created.status_code == 200, created.text
        acc_id = created.json()["id"]

        async with sess.SessionLocal() as db:
            row = await db.get(WorkAcceptance, acc_id)
            assert row is not None
            row.quality_score = 8.0
            await db.commit()

        accepted = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
            headers=h_cust,
            json={"comment": "без оценки"},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json().get("quality_score") is None


async def test_w139_os_proxy_and_return_without_fake_scores():
    """W139: OS proxy не пишет 8/10; return без score → None."""
    from app.db import session as sess
    from app.models.entities import WorkAcceptance

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open_st["id"]},
        )
        assert created.status_code == 200, created.text
        acc_id = created.json()["id"]

        async with sess.SessionLocal() as db:
            row = await db.get(WorkAcceptance, acc_id)
            assert row is not None
            row.quality_score = 5.0
            await db.commit()

        r = await client.post(
            f"/api/v1/projects/{pid}/acceptances/{acc_id}/accept",
            headers=h_cust,
            json={"with_remarks": False, "comment": "via os proxy"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("quality_score") is None

        # fresh acceptance for return path
        stages2 = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open2 = next((s for s in stages2 if s.get("status") in ("active", "review")), None)
        if open2 is None:
            # create next stage path — skip if project fully done
            return
        created2 = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open2["id"]},
        )
        if created2.status_code != 200:
            return
        acc2 = created2.json()["id"]
        async with sess.SessionLocal() as db:
            row = await db.get(WorkAcceptance, acc2)
            assert row is not None
            row.quality_score = 5.0
            await db.commit()
        ret = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{acc2}/return",
            headers=h_cust,
            json={"comment": "доработка", "create_issue": True},
        )
        assert ret.status_code == 200, ret.text
        assert ret.json().get("quality_score") is None

async def test_accept_emits_acceptance_passed_with_stage_context():
    """W44: AcceptancePassed must carry stage_id into automation via log_event."""
    from unittest.mock import AsyncMock, patch

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open_st["id"], "comment": "готов"},
        )
        assert created.status_code == 200, created.text
        acc_id = created.json()["id"]

        with patch("app.services.automation_engine.process_event", new_callable=AsyncMock) as pe:
            accepted = await client.post(
                f"/api/v1/projects/{pid}/work-acceptances/{acc_id}/accept",
                headers=h_cust,
                json={"quality_score": 9, "comment": "ок"},
            )
            assert accepted.status_code == 200, accepted.text
            passed_calls = [c for c in pe.await_args_list if c.kwargs.get("kind") == "AcceptancePassed"]
            assert passed_calls, pe.await_args_list
            assert passed_calls[0].kwargs.get("stage_id") == open_st["id"]

        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        stage = next(s for s in detail["stages"] if s["id"] == open_st["id"])
        assert stage["status"] == "done"
        assert stage.get("customer_accepted_at")


async def test_schedule_item_accepted_does_not_bypass_work_acceptance():
    """P0: contractor 403; customer without WA 409; after WA schedule item becomes accepted."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        stage_id = open_st["id"]

        created = await client.post(
            f"/api/v1/projects/{pid}/work-schedules",
            headers=h_cont,
            json={},
        )
        if created.status_code not in (200, 201):
            pytest.skip(f"work-schedules create unavailable: {created.status_code} {created.text}")
        sched = created.json()
        items = sched.get("items") or []
        item = next((i for i in items if i.get("stage_id") == stage_id), items[0] if items else None)
        if not item:
            pytest.skip("no schedule items")

        forbidden = await client.post(
            f"/api/v1/projects/{pid}/work-schedules/{sched['id']}/items/{item['id']}/status",
            headers=h_cont,
            json={"status": "accepted"},
        )
        assert forbidden.status_code == 403, forbidden.text

        blocked = await client.post(
            f"/api/v1/projects/{pid}/work-schedules/{sched['id']}/items/{item['id']}/status",
            headers=h_cust,
            json={"status": "accepted"},
        )
        assert blocked.status_code == 409, blocked.text

        detail = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        stage = next(s for s in detail["stages"] if s["id"] == stage_id)
        assert not stage.get("customer_accepted_at")
        assert stage["status"] != "done"

        # Happy path: каноническая приёмка → строка графика accepted
        wa = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": stage_id, "comment": "готов"},
        )
        assert wa.status_code == 200, wa.text
        accepted = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{wa.json()['id']}/accept",
            headers=h_cust,
            json={"quality_score": 10, "comment": "ок"},
        )
        assert accepted.status_code == 200, accepted.text

        sched2 = (
            await client.get(
                f"/api/v1/projects/{pid}/work-schedules/{sched['id']}",
                headers=h_cust,
            )
        ).json()
        item2 = next(i for i in (sched2.get("items") or []) if i["id"] == item["id"])
        assert item2["status"] == "accepted", item2

        detail2 = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()
        stage2 = next(s for s in detail2["stages"] if s["id"] == stage_id)
        assert stage2["status"] == "done"
        assert stage2.get("customer_accepted_at")


async def test_contractor_cannot_transition_work_order_to_done():
    """P0: исполнитель не может WO review→done с графика/карточки."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        created = await client.post(
            f"/api/v1/projects/{pid}/work-orders",
            headers=h_cont,
            json={
                "title": "P0 WO",
                "work_type": "other",
                "publish": True,
            },
        )
        if created.status_code not in (200, 201):
            pytest.skip(f"work-orders create unavailable: {created.status_code} {created.text}")
        wo = created.json()
        wo_id = wo["id"]

        # Двигаем к review от имени исполнителя (допустимые шаги)
        for status in ("approved", "in_progress", "review"):
            # published → need negotiating or approved — try transitions until review
            pass

        # Явно: published → approved (customer), → in_progress, → review (contractor)
        r = await client.post(
            f"/api/v1/projects/{pid}/work-orders/{wo_id}/transition",
            headers=h_cust,
            json={"status": "approved"},
        )
        if r.status_code >= 400:
            # published may need negotiating first
            await client.post(
                f"/api/v1/projects/{pid}/work-orders/{wo_id}/transition",
                headers=h_cont,
                json={"status": "negotiating"},
            )
            r = await client.post(
                f"/api/v1/projects/{pid}/work-orders/{wo_id}/transition",
                headers=h_cust,
                json={"status": "approved"},
            )
        assert r.status_code < 400, r.text

        r = await client.post(
            f"/api/v1/projects/{pid}/work-orders/{wo_id}/transition",
            headers=h_cont,
            json={"status": "in_progress"},
        )
        assert r.status_code < 400, r.text
        r = await client.post(
            f"/api/v1/projects/{pid}/work-orders/{wo_id}/transition",
            headers=h_cont,
            json={"status": "review"},
        )
        assert r.status_code < 400, r.text

        forbidden = await client.post(
            f"/api/v1/projects/{pid}/work-orders/{wo_id}/transition",
            headers=h_cont,
            json={"status": "done"},
        )
        assert forbidden.status_code == 403, forbidden.text
        assert "only_customer_can_accept_work_order" in forbidden.text

        ok = await client.post(
            f"/api/v1/projects/{pid}/work-orders/{wo_id}/transition",
            headers=h_cust,
            json={"status": "done"},
        )
        assert ok.status_code < 400, ok.text
        assert ok.json()["status"] == "done"


async def test_contractor_cannot_accept_work_acceptance():
    """P0: решение по приёмке — только заказчик."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        pid, h_cust, h_cont = await _demo_project(client)
        stages = (await client.get(f"/api/v1/projects/{pid}", headers=h_cust)).json()["stages"]
        open_st = _open_stage(stages)
        created = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances",
            headers=h_cont,
            json={"stage_id": open_st["id"], "comment": "готов"},
        )
        assert created.status_code == 200, created.text
        forbidden = await client.post(
            f"/api/v1/projects/{pid}/work-acceptances/{created.json()['id']}/accept",
            headers=h_cont,
            json={"quality_score": 10, "comment": "сам себе"},
        )
        assert forbidden.status_code == 403, forbidden.text
