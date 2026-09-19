"""Цена одного исполнителя не должна быть видна другому.

Список предложений скрыт правильно: исполнитель видит в `quotes` только
свои. Но отправка предложения перезаписывала `lead.pre_estimate`, а это
поле отдаётся всем. Через него конкурент читал последнюю поданную цену и
мог подать на рубль меньше.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.models.entities import JobLead, User, UserRole

from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def stand(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path}/quotes.db"
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
        # Демо-вход отдаёт одного и того же пользователя на роль, а нам нужны
        # два разных исполнителя — конкуренты по одной заявке.
        db.add_all(
            [
                User(id="rival-a", phone="+79001110001", role=UserRole.contractor, full_name="Исполнитель А"),
                User(id="rival-b", phone="+79001110002", role=UserRole.contractor, full_name="Исполнитель Б"),
            ]
        )
        await db.commit()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def create_lead(client) -> tuple[str, str]:
    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    response = await client.post(
        "/api/v1/job-leads",
        headers={"X-User-Id": customer["id"]},
        json={
            "title": "Ремонт двушки",
            "address": "Москва, ул. Пример, 12",
            "area_sqm": 54,
            "renovation_type": "cosmetic",
            "budget_hint": 800000,
            "description": "Под ключ",
        },
    )
    assert response.status_code == 200, response.text
    return customer["id"], response.json()["id"]


async def test_a_rival_cannot_read_the_submitted_price(stand):
    client = stand
    _, lead_id = await create_lead(client)

    submitted = await client.post(
        f"/api/v1/job-leads/{lead_id}/quote",
        headers={"X-User-Id": "rival-a"},
        json={"pre_estimate": 870000},
    )
    assert submitted.status_code == 200, submitted.text

    seen = await client.get("/api/v1/job-leads", headers={"X-User-Id": "rival-b"})
    assert seen.status_code == 200, seen.text
    body = next(item for item in seen.json() if item["id"] == lead_id)

    assert body.get("pre_estimate") != 870000, (
        "конкурент прочитал поданную цену через pre_estimate заявки"
    )
    assert body.get("quotes", []) == [], "чужие предложения не должны быть видны"
    dumped = str(body)
    assert "870000" not in dumped, f"цена утекла где-то ещё в ответе: {dumped}"


async def test_the_author_still_sees_their_own_quote(stand):
    client = stand
    _, lead_id = await create_lead(client)
    await client.post(
        f"/api/v1/job-leads/{lead_id}/quote",
        headers={"X-User-Id": "rival-a"},
        json={"pre_estimate": 870000},
    )

    seen = await client.get("/api/v1/job-leads", headers={"X-User-Id": "rival-a"})
    row = next(item for item in seen.json() if item["id"] == lead_id)
    quotes = row.get("quotes", [])
    assert len(quotes) == 1
    assert quotes[0]["pre_estimate"] == 870000


async def test_the_customer_sees_every_quote(stand):
    """Скрывать от заказчика нечего — он для того и собирает предложения."""
    client = stand
    customer_id, lead_id = await create_lead(client)
    for who, price in (("rival-a", 870000), ("rival-b", 910000)):
        await client.post(
            f"/api/v1/job-leads/{lead_id}/quote",
            headers={"X-User-Id": who},
            json={"pre_estimate": price},
        )

    seen = await client.get("/api/v1/job-leads", headers={"X-User-Id": customer_id})
    row = next(item for item in seen.json() if item["id"] == lead_id)
    prices = sorted(q["pre_estimate"] for q in row.get("quotes", []))
    assert prices == [870000, 910000]


async def test_accepted_quote_becomes_the_lead_price(stand):
    """После выбора заказчиком цена перестаёт быть тайной — сделка состоялась."""
    client = stand
    customer_id, lead_id = await create_lead(client)
    quote = await client.post(
        f"/api/v1/job-leads/{lead_id}/quote",
        headers={"X-User-Id": "rival-a"},
        json={"pre_estimate": 870000},
    )
    quote_id = quote.json()["quote_id"]

    accepted = await client.post(
        f"/api/v1/job-leads/{lead_id}/quotes/{quote_id}/accept",
        headers={"X-User-Id": customer_id},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["pre_estimate"] == 870000

    seen = await client.get(
        "/api/v1/job-leads?status=quoted", headers={"X-User-Id": "rival-a"}
    )
    row = next(item for item in seen.json() if item["id"] == lead_id)
    assert row["pre_estimate"] == 870000


async def test_the_lead_does_not_store_a_rival_price_at_all(stand):
    """Скрыть мало: чужая цена не должна попадать в поле заявки вообще.

    Фильтр на выдаче закрывает утечку, но пока значение лежит в базе, любой
    новый обработчик или выгрузка снова его покажут. Здесь проверяется само
    хранимое поле, а не ответ.
    """
    client = stand
    _, lead_id = await create_lead(client)
    await client.post(
        f"/api/v1/job-leads/{lead_id}/quote",
        headers={"X-User-Id": "rival-a"},
        json={"pre_estimate": 870000},
    )

    from app.db import session as sess

    async with sess.SessionLocal() as db:
        lead = await db.get(JobLead, lead_id)
        assert not lead.pre_estimate, (
            f"в заявке сохранена цена исполнителя: {lead.pre_estimate}"
        )
