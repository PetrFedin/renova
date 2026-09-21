"""Прогресс считается одной формулой, прогноз — одной, и обе не врут.

Найдено сплошным разбором проекта и подтверждено на живых данных. Демо-объект,
план 194 437,70 ₽, потрачено 5 000 ₽:

    GET /analytics/budget-forecast → forecast_total 500 000 ₽, risk "high"
    GET /os/budget                 → forecast = план,          risk "ok"

Причина у обоих ответов одна: колонка `projects.progress_percent` в продукте
не вычисляется ни одной записью (единственное присваивание — в демо-заполнении),
и оба потребителя читали ноль. Сводка спасалась порогом «прогноз только выше
5 %», аналитика подставляла вместо нуля единицу — и делила факт на 0.01,
превращая 5 000 ₽ в прогноз 500 000 ₽ и перерасход 305 562 ₽.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.services import stage_status_service as st_status
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def prog_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


def test_near_zero_progress_does_not_multiply_the_forecast():
    # Тот самый случай с живого стенда.
    forecast = st_status.burn_forecast(spent=5000.0, planned=194437.7, progress_percent=0.0)
    assert forecast == 194437.7, "прогноз снова считается от почти нулевого прогресса"


def test_forecast_by_burn_rate_works_above_the_threshold():
    # Половина работ сделана, потрачено 100 000 → ожидаем 200 000.
    assert st_status.burn_forecast(spent=100000.0, planned=180000.0, progress_percent=50.0) == 200000.0


def test_threshold_is_named_not_scattered():
    # Порог был записан числом в одном месте и отсутствовал в другом.
    assert st_status.FORECAST_MIN_PROGRESS_PCT == 5.0
    assert st_status.burn_forecast(spent=9.0, planned=100.0, progress_percent=5.0) == 100.0
    assert st_status.burn_forecast(spent=9.0, planned=100.0, progress_percent=5.1) != 100.0


async def test_progress_comes_from_stages_not_from_the_dead_column(prog_db):
    user = User(id="pr-user", phone="+79997770001", role=UserRole.customer)
    project = Project(
        id="pr-project", name="Объект", renovation_type="cosmetic",
        customer_id=user.id, progress_percent=0.0,
    )
    prog_db.add_all([user, project])
    await prog_db.commit()
    prog_db.add_all([
        Stage(id="pr-s1", project_id=project.id, name="Демонтаж", sort_order=0,
              status=StageStatus.done, percent_complete=100, weight_coefficient=1),
        Stage(id="pr-s2", project_id=project.id, name="Стены", sort_order=1,
              status=StageStatus.active, percent_complete=0, weight_coefficient=1),
    ])
    await prog_db.commit()

    fresh = await prog_db.get(Project, project.id)
    await prog_db.refresh(fresh, ["stages"])
    assert fresh.progress_percent == 0.0, "колонка по-прежнему не вычисляется — это и есть причина"
    assert st_status.project_progress(fresh) == 50.0


async def test_weights_are_respected(prog_db):
    user = User(id="pr-user2", phone="+79997770002", role=UserRole.customer)
    project = Project(id="pr-project2", name="Объект", renovation_type="cosmetic", customer_id=user.id)
    prog_db.add_all([user, project])
    await prog_db.commit()
    prog_db.add_all([
        Stage(id="pr-w1", project_id=project.id, name="Большой", sort_order=0,
              percent_complete=100, weight_coefficient=3),
        Stage(id="pr-w2", project_id=project.id, name="Малый", sort_order=1,
              percent_complete=0, weight_coefficient=1),
    ])
    await prog_db.commit()

    fresh = await prog_db.get(Project, project.id)
    await prog_db.refresh(fresh, ["stages"])
    assert st_status.project_progress(fresh) == 75.0


async def test_project_without_stages_is_zero(prog_db):
    user = User(id="pr-user3", phone="+79997770003", role=UserRole.customer)
    project = Project(id="pr-project3", name="Пустой", renovation_type="cosmetic", customer_id=user.id)
    prog_db.add_all([user, project])
    await prog_db.commit()

    fresh = await prog_db.get(Project, project.id)
    await prog_db.refresh(fresh, ["stages"])
    assert st_status.project_progress(fresh) == 0.0


def test_both_consumers_call_the_same_helper():
    # Смысл правки: одно число — одна формула. Разъедется снова, если кто-то
    # вернётся к чтению колонки или заведёт свой делитель.
    from pathlib import Path

    from app.api.v1 import analytics
    from app.services import budget_service_legacy

    for module in (analytics, budget_service_legacy):
        source = Path(module.__file__).read_text(encoding="utf-8")
        assert "burn_forecast(" in source, f"{module.__name__} считает прогноз сам"
    analytics_source = Path(analytics.__file__).read_text(encoding="utf-8")
    assert "max(p.progress_percent, 1)" not in analytics_source
