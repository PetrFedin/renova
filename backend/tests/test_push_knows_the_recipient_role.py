"""Push открывает маршруты той роли, которой он адресован.

В payload push уходили только `link_path` и `returnTo`. Поля `role` не было,
а клиент читает его так:

    role: data?.role === 'contractor' ? 'contractor' : 'customer'

то есть при отсутствии поля всегда получался заказчик. Исполнитель, тапнув
push «Новое замечание», проваливался в `/(customer)/(tabs)/repair?tab=control`
— чужую группу маршрутов.

Безролевых `link_path` в бэкенде хватает: один только «/control» отдаётся в
семи местах `api/v1/os.py`, причём в одном из них рассылается сразу обеим
сторонам.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import Project, User, UserRole
from app.services import notification_service as notify_svc


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def stand(db):
    customer = User(id="push-customer", phone="+79200000001", role=UserRole.customer)
    contractor = User(id="push-contractor", phone="+79200000002", role=UserRole.contractor)
    project = Project(
        id="push-project",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return {"customer": customer, "contractor": contractor, "project": project}


def _capture(monkeypatch) -> list[dict]:
    sent: list[dict] = []

    async def fake_send_push(_db, user_id, _title, _body, data=None, **_kwargs):
        sent.append({"user_id": user_id, "data": dict(data or {})})
        return True

    monkeypatch.setattr(notify_svc, "send_push", fake_send_push)
    return sent


@pytest.mark.asyncio
async def test_a_contractor_push_says_it_is_for_a_contractor(db, stand, monkeypatch):
    sent = _capture(monkeypatch)

    await notify_svc.notify(
        db,
        user_id=stand["contractor"].id,
        project_id=stand["project"].id,
        notification_type="issue_new",
        title="Новое замечание",
        body="Кухня",
        link_path="/control",
    )

    assert sent, "push вообще не отправился"
    assert sent[0]["data"]["role"] == "contractor", (
        "исполнитель по push уйдёт в маршруты заказчика"
    )


@pytest.mark.asyncio
async def test_a_customer_push_says_customer(db, stand, monkeypatch):
    """Страховка от «всем ставить contractor»."""
    sent = _capture(monkeypatch)

    await notify_svc.notify(
        db,
        user_id=stand["customer"].id,
        project_id=stand["project"].id,
        notification_type="issue_new",
        title="Новое замечание",
        body="Кухня",
        link_path="/control",
    )

    assert sent[0]["data"]["role"] == "customer"


@pytest.mark.asyncio
async def test_the_same_link_goes_to_each_side_in_its_own_routes(db, stand, monkeypatch):
    """`/control` рассылается обеим сторонам сразу — роли должны отличаться."""
    sent = _capture(monkeypatch)

    for user in (stand["customer"], stand["contractor"]):
        await notify_svc.notify(
            db,
            user_id=user.id,
            project_id=stand["project"].id,
            notification_type="issue_new",
            title="Новое замечание",
            body="Кухня",
            link_path="/control",
        )

    roles = [item["data"]["role"] for item in sent]
    assert roles == ["customer", "contractor"], (
        f"один и тот же безролевой путь ушёл обеим сторонам одинаково: {roles}"
    )


@pytest.mark.asyncio
async def test_an_unknown_recipient_keeps_the_previous_behaviour(db, monkeypatch):
    """Неизвестный пользователь — заказчик, как было до правки: ничего не ломаем."""
    assert await notify_svc._recipient_role(db, "no-such-user") == "customer"
