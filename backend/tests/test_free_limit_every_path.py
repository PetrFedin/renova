"""Лимит бесплатного тарифа держится на всех путях получения объекта.

Назначение исполнителя лимит проверяет. Конвертация заявки биржи в объект —
не проверяла вовсе, хотя приводит ровно к тому же результату: у исполнителя
становится на один объект больше. Платить за Pro было незачем: объекты
берутся с биржи.
"""
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.models.entities import JobLead, JobLeadStatus, Project, User, UserRole
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed_at_the_limit(db) -> tuple[User, User, JobLead]:
    """Исполнитель уже выбрал бесплатный лимит, и его ждёт заявка."""
    customer = User(id="c-limit", phone="+79990001111", role=UserRole.customer)
    contractor = User(id="k-limit", phone="+78880001111", role=UserRole.contractor)
    db.add_all([customer, contractor])
    for index in range(settings.contractor_free_project_limit):
        db.add(
            Project(
                id=f"p-existing-{index}",
                name=f"Объект {index}",
                renovation_type="cosmetic",
                customer_id=customer.id,
                contractor_id=contractor.id,
            )
        )
    lead = JobLead(
        id="lead-limit",
        customer_id=customer.id,
        title="Ремонт трёшки",
        address="Москва, ул. Пример, 12",
        area_sqm=70,
        renovation_type="cosmetic",
        budget_hint=900000,
        assigned_contractor_id=contractor.id,
        status=JobLeadStatus.quoted,
    )
    db.add(lead)
    await db.commit()
    return customer, contractor, lead


async def project_count(db, contractor_id: str) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(Project).where(Project.contractor_id == contractor_id)
        )
        or 0
    )


@pytest.mark.asyncio
async def test_conversion_respects_the_free_limit(db):
    from app.services import marketplace_conversion_service as conversion

    _, contractor, lead = await seed_at_the_limit(db)
    before = await project_count(db, contractor.id)

    allowed = await conversion.contractor_may_take_one_more(db, contractor_id=contractor.id)

    assert allowed is False, (
        f"исполнитель с {before} объектами на бесплатном тарифе берёт ещё один с биржи"
    )


@pytest.mark.asyncio
async def test_a_contractor_below_the_limit_may_convert(db):
    from app.services import marketplace_conversion_service as conversion

    customer = User(id="c-free", phone="+79990002222", role=UserRole.customer)
    contractor = User(id="k-free", phone="+78880002222", role=UserRole.contractor)
    db.add_all([customer, contractor])
    await db.commit()

    allowed = await conversion.contractor_may_take_one_more(db, contractor_id=contractor.id)

    assert allowed is True, "первый объект должен быть доступен без подписки"


@pytest.mark.asyncio
async def test_pro_is_not_limited(db):
    from app.models.entities import Subscription
    from app.services import marketplace_conversion_service as conversion

    _, contractor, _ = await seed_at_the_limit(db)
    db.add(
        Subscription(
            user_id=contractor.id,
            plan="pro",
            status="active",
        )
    )
    await db.commit()

    allowed = await conversion.contractor_may_take_one_more(db, contractor_id=contractor.id)

    assert allowed is True, "оплаченный Pro не должен упираться в бесплатный лимит"


@pytest.mark.asyncio
async def test_the_two_paths_agree(db):
    """Назначение и конвертация решают одинаково — иначе лимит обходится."""
    from app.services import marketplace_conversion_service as conversion
    from app.services.project_assignment_service import _project_count
    from app.services.subscription_service import is_pro

    _, contractor, _ = await seed_at_the_limit(db)

    assignment_allows = not (
        await _project_count(db, contractor.id) >= settings.contractor_free_project_limit
        and not await is_pro(db, contractor.id)
    )
    conversion_allows = await conversion.contractor_may_take_one_more(
        db, contractor_id=contractor.id
    )

    assert assignment_allows == conversion_allows, (
        f"пути расходятся: назначение {assignment_allows}, конвертация {conversion_allows}"
    )


@pytest.mark.asyncio
async def test_the_refusal_reaches_the_client_as_402(db):
    """Отказ по лимиту — 402 с текстом, как и на пути назначения, а не 422."""
    from app.api.v1.marketplace_conversion_integrity import _conversion_error

    error = _conversion_error(ValueError("subscription_required"))

    assert error.status_code == 402, (
        f"клиент получит {error.status_code} вместо понятного отказа по подписке"
    )
    assert error.detail["code"] == "subscription_required"
    assert error.detail.get("message"), "код без текста клиенту нечем показать"


@pytest.mark.asyncio
async def test_a_replay_is_not_refused_by_the_limit_it_filled(db):
    """Повтор уже выполненной конвертации возвращает объект, а не платёжную стену.

    Проверка лимита стоит ПОСЛЕ разбора повтора. Если поставить её раньше,
    переигровка после потери ответа упирается в лимит, который занял тот же
    самый объект — пользователю отказывают в том, что уже сделано.
    """
    import inspect

    from app.services import marketplace_conversion_service as conversion

    source = inspect.getsource(conversion.convert_lead)
    replay_at = source.index("if replay_id:")
    limit_at = source.index("contractor_may_take_one_more")

    assert limit_at > replay_at, (
        "лимит проверяется до разбора повтора — переигровка получит отказ по подписке"
    )
