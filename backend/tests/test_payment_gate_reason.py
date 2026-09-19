"""Отказ в подтверждении оплаты должен называть настоящую причину.

Ветка для этапного платежа стоит раньше разбора причины, поэтому любой
отказ по этапу объясняется одинаково — «Сначала примите этап» — и в ленту
объекта пишется событие «Оплата заблокирована». Даже когда этап давно
принят, а платёж отменён или оспорен.

Повторное подтверждение уже подтверждённого платежа отвечает 200 — это
намеренная идемпотентность для повторов отправки, и она здесь не трогается.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core import config as cfg
from app.core.timeutil import utc_now
from app.db.session import init_db
from app.main import app
from app.models.entities import (
    ActivityEvent,
    Payment,
    PaymentStatus,
    PaymentType,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
)
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def stand(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path}/pay_gate.db"
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
        yield http, sess


async def seed_stage_payment(
    sess,
    *,
    suffix: str,
    status: PaymentStatus,
    accepted: bool,
) -> tuple[str, str, str]:
    async with sess.SessionLocal() as db:
        customer = User(id=f"c-{suffix}", phone=f"+7999{suffix:0>7}", role=UserRole.customer)
        contractor = User(id=f"k-{suffix}", phone=f"+7888{suffix:0>7}", role=UserRole.contractor)
        project = Project(
            id=f"p-{suffix}",
            name="Объект",
            renovation_type="cosmetic",
            customer_id=customer.id,
            contractor_id=contractor.id,
        )
        stage = Stage(
            id=f"s-{suffix}",
            project_id=project.id,
            name="Черновые работы",
            sort_order=0,
            status=StageStatus.done if accepted else StageStatus.active,
            percent_complete=100 if accepted else 40,
            payment_amount=50000,
            weight_coefficient=1.0,
            customer_accepted_at=utc_now() if accepted else None,
        )
        payment = Payment(
            id=f"pay-{suffix}",
            project_id=project.id,
            stage_id=stage.id,
            payment_type=PaymentType.stage,
            status=status,
            title="Оплата этапа: Черновые работы",
            amount=50000,
            created_by=customer.id,
        )
        db.add_all([customer, contractor, project, stage, payment])
        await db.commit()
        return customer.id, project.id, payment.id


async def confirm(client, user_id: str, project_id: str, payment_id: str):
    return await client.post(
        f"/api/v1/projects/{project_id}/payments/{payment_id}/confirm",
        headers={"X-User-Id": user_id},
        json={"transfer_ack": True},
    )


def message_of(response) -> str:
    detail = response.json()["detail"]
    return detail if isinstance(detail, str) else str(detail.get("message", detail))


async def activity_kinds(sess, project_id: str) -> list[str]:
    async with sess.SessionLocal() as db:
        rows = await db.execute(
            select(ActivityEvent.kind).where(ActivityEvent.project_id == project_id)
        )
        return list(rows.scalars().all())


@pytest.mark.parametrize(
    "status",
    [PaymentStatus.cancelled, PaymentStatus.refunded, PaymentStatus.disputed],
)
async def test_accepted_stage_is_never_blamed_for_a_terminal_payment(stand, status):
    """Этап принят. Платёж в терминальном состоянии — приёмка ни при чём."""
    client, sess = stand
    user_id, project_id, payment_id = await seed_stage_payment(
        sess, suffix=f"00{status.value[:2]}", status=status, accepted=True
    )

    response = await confirm(client, user_id, project_id, payment_id)

    assert response.status_code == 409
    message = message_of(response)
    assert "примите этап" not in message, (
        f"платёж в статусе {status.value} на принятом этапе, "
        f"а отказ объясняют приёмкой: {message}"
    )


async def test_terminal_payment_does_not_write_a_blocked_event(stand):
    client, sess = stand
    user_id, project_id, payment_id = await seed_stage_payment(
        sess, suffix="0010", status=PaymentStatus.cancelled, accepted=True
    )

    await confirm(client, user_id, project_id, payment_id)

    kinds = await activity_kinds(sess, project_id)
    assert "PaymentBlocked" not in kinds, (
        "в ленту объекта записали блокировку оплаты, хотя этап принят"
    )


async def test_unaccepted_stage_still_says_accept_first(stand):
    """Настоящая блокировка по приёмке никуда не делась."""
    client, sess = stand
    user_id, project_id, payment_id = await seed_stage_payment(
        sess, suffix="0020", status=PaymentStatus.pending, accepted=False
    )

    response = await confirm(client, user_id, project_id, payment_id)

    assert response.status_code == 409
    assert "примите этап" in message_of(response)


async def test_real_block_still_reaches_the_activity_feed(stand):
    """Событие о блокировке нужно — но только когда блокировка настоящая."""
    client, sess = stand
    user_id, project_id, payment_id = await seed_stage_payment(
        sess, suffix="0030", status=PaymentStatus.pending, accepted=False
    )

    await confirm(client, user_id, project_id, payment_id)

    assert "PaymentBlocked" in await activity_kinds(sess, project_id)


async def test_repeated_confirmation_stays_idempotent(stand):
    """Повтор подтверждения — это повтор отправки, а не ошибка."""
    client, sess = stand
    user_id, project_id, payment_id = await seed_stage_payment(
        sess, suffix="0040", status=PaymentStatus.confirmed, accepted=True
    )

    response = await confirm(client, user_id, project_id, payment_id)

    assert response.status_code == 200, (
        "идемпотентность повтора нужна офлайн-очереди и ломать её нельзя"
    )
    assert response.json()["status"] == "confirmed"
