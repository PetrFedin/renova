"""Одно неотправляемое уведомление не должно ронять посторонние запросы.

Две независимые беды, которые вместе дают 500 на действии, к ним отношения
не имеющем:

1. При одобрении подтверждения перевода в outbox кладётся уведомление с
   ``body = evidence.rejection_reason``. У одобренного подтверждения причины
   отказа нет — а колонка ``app_notifications.body`` NOT NULL. Строка не
   доставится никогда, и заказчик не узнает, что перевод принят.

2. ``dispatch_best_effort`` получает сессию самого HTTP-запроса и при сбое
   доставки делает на ней ``rollback``. Объекты запроса истекают, следующее
   же обращение к ним пытается догрузиться синхронно — и хендлер падает уже
   после того, как запись прошла.
"""
import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core import config as cfg
from app.db.session import init_db
import app.models.outbox_runtime  # noqa: F401
from app.main import app as fastapi_app
from app.models.entities import AppNotification, DomainOutbox, Project, UserRole

from app.services import outbox_service
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def stand(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path}/poison.db"
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
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http, sess


async def test_approved_transfer_notification_has_a_body(stand):
    """У одобренного подтверждения нет причины отказа — и не должно быть пустого текста."""
    from app.services.client_write_side_effects import prepare_client_write_side_effects
    from app.models.payment_evidence import PaymentEvidence

    _client, sess = stand
    async with sess.SessionLocal() as db:
        project = (await db.execute(select(Project).limit(1))).scalar_one()
        from app.models.entities import Payment, PaymentType

        payment = Payment(
            project_id=project.id,
            payment_type=PaymentType.material,
            title="Материалы",
            amount=1000,
            created_by=project.customer_id,
        )
        db.add(payment)
        await db.flush()
        evidence = PaymentEvidence(
            project_id=project.id,
            payment_id=payment.id,
            version=1,
            storage_key="evidence/approved-1.pdf",
            original_filename="чек.pdf",
            declared_content_type="application/pdf",
            status="approved",
            rejection_reason=None,
            submitted_by=project.customer_id,
        )
        db.add(evidence)
        await db.commit()

        await prepare_client_write_side_effects(
            db,
            scope="payment_evidence.review",
            project_id=project.id,
            user_id=project.customer_id,
            entity_id=evidence.id,
        )
        await db.commit()

        rows = list(
            (
                await db.execute(
                    select(DomainOutbox).where(
                        DomainOutbox.event_type == outbox_service.NOTIFICATION_EVENT
                    )
                )
            ).scalars().all()
        )
        assert rows, "уведомление не поставлено в очередь"
        for row in rows:
            body = json.loads(row.payload_json or "{}").get("body")
            assert body, (
                "уведомление уйдёт с пустым текстом и никогда не доставится: "
                f"{row.payload_json}"
            )


async def test_a_poisoned_row_does_not_break_an_unrelated_write(stand):
    """Отравленная строка не должна ронять чужой запрос.

    Сбой доставки откатывает сессию самого HTTP-запроса. Уже загруженные
    объекты истекают, и хендлер падает при формировании ответа — после того,
    как запись уже прошла. Пользователь видит ошибку на успешном действии.
    """
    client, sess = stand

    customer = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    headers = {"X-User-Id": customer["id"]}
    project_id = (await client.get("/api/v1/projects", headers=headers)).json()[0]["id"]

    async with sess.SessionLocal() as db:
        await outbox_service.enqueue(
            db,
            aggregate_type="payment_evidence",
            aggregate_id="poison",
            event_type=outbox_service.NOTIFICATION_EVENT,
            payload={
                # Получателя нет: колонка user_id NOT NULL, доставка не пройдёт
                # никогда. Пустой текст здесь не годится — его перехватывает
                # рубеж в notification_service, и отказа не случится.
                "user_id": None,
                "project_id": project_id,
                "notification_type": "payment_confirmed",
                "title": "Перевод подтверждён",
                "body": "Оплата принята",
                "link_path": "/(customer)/(tabs)/budget?tab=payments",
            },
        )
        await db.commit()

    response = await client.post(
        f"/api/v1/projects/{project_id}/issues",
        headers=headers,
        json={"title": "Скол на плитке", "severity": "high"},
    )

    assert response.status_code == 200, (
        f"создание замечания упало из-за чужого уведомления: "
        f"{response.status_code} {response.text[:200]}"
    )


async def test_delivery_failure_is_still_recorded(stand):
    """Изоляция не должна превращаться в замалчивание сбоя."""
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    _client, sess = stand
    async with sess.SessionLocal() as db:
        project = (await db.execute(select(Project).limit(1))).scalar_one()
        row = await outbox_service.enqueue(
            db,
            aggregate_type="payment_evidence",
            aggregate_id="poison-2",
            event_type=outbox_service.NOTIFICATION_EVENT,
            payload={
                # Получателя нет вовсе: колонка user_id NOT NULL.
                "user_id": None,
                "project_id": project.id,
                "notification_type": "payment_confirmed",
                "title": "Перевод подтверждён",
                "body": "Оплата принята",
                "link_path": "/x",
            },
        )
        await db.commit()
        row_id = row.id

        await dispatch_best_effort(db, source="test.poison", limit=10)

    async with sess.SessionLocal() as db:
        stored = await db.get(DomainOutbox, row_id)
        assert stored is not None, "строку нельзя терять — её должен добрать воркер"
        assert stored.processed_at is None, "неудачная доставка не может считаться выполненной"
        assert stored.attempts >= 1, "попытка должна быть засчитана"
        assert stored.last_error, "причина сбоя должна остаться видимой"


async def test_a_healthy_notification_still_reaches_the_user(stand):
    """Проверяем, что изоляция не сломала нормальную доставку."""
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    _client, sess = stand
    async with sess.SessionLocal() as db:
        project = (await db.execute(select(Project).limit(1))).scalar_one()
        await outbox_service.enqueue(
            db,
            aggregate_type="payment_evidence",
            aggregate_id="healthy",
            event_type=outbox_service.NOTIFICATION_EVENT,
            payload={
                "user_id": project.customer_id,
                "project_id": project.id,
                "notification_type": "payment_confirmed",
                "title": "Перевод подтверждён",
                "body": "Оплата этапа принята",
                "link_path": "/(customer)/(tabs)/budget?tab=payments",
            },
        )
        await db.commit()
        await dispatch_best_effort(db, source="test.healthy", limit=10)

    async with sess.SessionLocal() as db:
        delivered = list(
            (
                await db.execute(
                    select(AppNotification).where(
                        AppNotification.title == "Перевод подтверждён"
                    )
                )
            ).scalars().all()
        )
        assert delivered, "здоровое уведомление не дошло"


async def test_an_empty_body_can_no_longer_poison_the_queue(stand):
    """Рубеж: producer с пустым текстом больше не создаёт вечно падающую строку.

    Причина починена отдельно, но класс ошибки повторим — любой новый
    producer может снова прислать пустой body. Доставка не должна от этого
    ломаться: заголовок несёт суть, а неотправляемая строка роняла чужие
    запросы.
    """
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    _client, sess = stand
    async with sess.SessionLocal() as db:
        project = (await db.execute(select(Project).limit(1))).scalar_one()
        await outbox_service.enqueue(
            db,
            aggregate_type="payment_evidence",
            aggregate_id="empty-body",
            event_type=outbox_service.NOTIFICATION_EVENT,
            payload={
                "user_id": project.customer_id,
                "project_id": project.id,
                "notification_type": "payment_confirmed",
                "title": "Перевод подтверждён",
                "body": None,
                "link_path": "/(customer)/(tabs)/budget?tab=payments",
            },
        )
        await db.commit()
        await dispatch_best_effort(db, source="test.empty-body", limit=10)

    async with sess.SessionLocal() as db:
        delivered = list(
            (
                await db.execute(
                    select(AppNotification).where(
                        AppNotification.title == "Перевод подтверждён"
                    )
                )
            ).scalars().all()
        )
        assert delivered, "уведомление с пустым текстом так и не доставлено"
        assert delivered[0].body, "текст должен быть подставлен, а не остаться пустым"
