"""Одна честная формула прогноза вместо трёх разных.

Прогноз бюджета считался в трёх местах, тремя несовпадающими способами:

    risk_engine.py:41       spent + (planned - spent) * (100 - progress)/max(progress, 1)
    analytics.py:128        budget_spent / (max(progress_percent, 1) / 100)
    budget_service_legacy   actual / (progress/100) if progress > 5 else total_plan

Первая — не экстраполяция факта вовсе: она масштабирует *неизрасходованный*
остаток, поэтому при нулевом факте ответ вообще не зависел от трат, а при
прогрессе 0,5% множитель доходил до 99. На демо-стенде это давало
«+18 754 332 ₽ к смете» при смете 194 437 ₽.

Вторая и третья читали `projects.progress_percent` — колонку, которую не
пишет ничего, кроме демо-сидера. На живом проекте она остаётся нулём, значит
`max(progress, 1)` превращал прогноз в факт, умноженный на сто.

Третья при малом прогрессе подставляла план и тем самым утверждала «уложимся
ровно в смету» там, где данных ещё нет.

Теперь все три зовут `budget_forecast`, прогресс берётся живой — тот же
`weighted_progress`, что показывает дашборд, — а ниже порога прогноза нет:
None, а не число.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import (
    EstimateLine,
    Expense,
    Project,
    Stage,
    StageStatus,
    User,
    UserRole,
)
from app.services import budget_forecast as bf
from app.services import budget_service, risk_engine

PLAN = 194_437.0


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _seed(
    db,
    suffix: str,
    *,
    spent: float,
    stage_progress: list[float],
    stored_progress_percent: float = 0.0,
) -> Project:
    customer = User(id=f"fc-cust-{suffix}", phone=f"+7900{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"fc-contr-{suffix}", phone=f"+7911{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"fc-proj-{suffix}",
        name="Прогноз",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=PLAN,
        budget_spent=spent,
        # Мёртвая колонка: живой прогресс задаётся этапами ниже.
        progress_percent=stored_progress_percent,
    )
    db.add_all([customer, contractor, project])
    await db.flush()

    for index, percent in enumerate(stage_progress):
        db.add(
            Stage(
                id=f"fc-stage-{suffix}-{index}",
                project_id=project.id,
                name=f"Этап {index + 1}",
                sort_order=index,
                status=StageStatus.done if percent >= 100 else StageStatus.active,
                percent_complete=percent,
                weight_coefficient=1,
            )
        )
    # План живёт в смете — `budget_summary` материализует его оттуда, — а факт
    # складывается из расходов, а не из колонки `budget_spent`.
    db.add(
        EstimateLine(
            id=f"fc-line-{suffix}",
            project_id=project.id,
            line_type="work",
            name="Работы",
            unit="м²",
            quantity_planned=1,
            unit_price=PLAN,
        )
    )
    if spent:
        db.add(
            Expense(
                id=f"fc-exp-{suffix}",
                project_id=project.id,
                title="Работы",
                category="works",
                amount=spent,
                status="confirmed",
            )
        )
    await db.commit()
    return project


# --- сама формула ------------------------------------------------------------


def test_the_forecast_extrapolates_the_spend_not_the_remainder():
    """Потрачено 50 000 на четверти работ — значит ожидается 200 000."""
    assert bf.forecast_total(50_000, 25) == pytest.approx(200_000)
    assert bf.forecast_total(150_000, 75) == pytest.approx(200_000)
    # Работы закончены: прогноз — это факт, а не деление на единицу.
    assert bf.forecast_total(180_000, 100) == pytest.approx(180_000)


def test_there_is_no_forecast_while_there_is_nothing_to_extrapolate():
    """Именно здесь старая формула выдавала десятки миллионов."""
    assert bf.forecast_total(0, 50) is None, "нулевой факт нечего продлевать"
    assert bf.forecast_total(10_000, 0.5) is None, "0,5% — множитель 200"
    assert bf.forecast_total(10_000, bf.MIN_PROGRESS_PCT - 0.1) is None
    # …а ровно на пороге прогноз уже есть: иначе «нет данных» навсегда.
    assert bf.forecast_total(10_000, bf.MIN_PROGRESS_PCT) == pytest.approx(100_000)


def test_no_forecast_means_no_overrun_and_no_verdict():
    assert bf.forecast_overrun(None, PLAN) is None
    assert bf.forecast_risk(None, PLAN) == "unknown"
    # Перерасход не бывает отрицательным: экономия — это не «минус риск».
    assert bf.forecast_overrun(100_000, PLAN) == 0.0
    assert bf.forecast_risk(100_000, PLAN) == "ok"
    assert bf.forecast_risk(PLAN * 1.2, PLAN) == "high"


# --- три места, один ответ ---------------------------------------------------


@pytest.mark.asyncio
async def test_the_call_sites_agree_on_the_number(db):
    project = await _seed(db, "agree", spent=60_000, stage_progress=[100, 50, 0, 0])
    # weighted_progress: (100+50+0+0)/4 = 37.5
    expected = bf.forecast_total(60_000, 37.5)
    assert expected == pytest.approx(160_000)

    summary = await budget_service.budget_summary(db, project.id)
    assert summary["forecast_total"] == pytest.approx(expected)
    assert summary["forecast_over"] == pytest.approx(
        bf.forecast_overrun(expected, summary["budget_planned"])
    )


@pytest.mark.asyncio
async def test_a_barely_started_project_gets_no_forecast_instead_of_the_plan(db):
    """Старое поведение подставляло план — «уложимся ровно в смету»."""
    project = await _seed(db, "early", spent=12_000, stage_progress=[2, 0, 0, 0])

    summary = await budget_service.budget_summary(db, project.id)

    assert summary["forecast_total"] is None, (
        "прогноз выдан на прогрессе 0,5% — это домысел, а не расчёт"
    )
    assert summary["forecast_over"] is None
    assert summary["risk"] == "unknown"


@pytest.mark.asyncio
async def test_the_live_progress_is_used_not_the_stored_column(db):
    """Колонка и этапы намеренно расходятся: ответ должен идти от этапов."""
    project = await _seed(
        db,
        "live",
        spent=100_000,
        stage_progress=[100, 100, 0, 0],   # живой прогресс 50%
        stored_progress_percent=0.0,        # колонка, как на любом реальном проекте
    )

    summary = await budget_service.budget_summary(db, project.id)

    assert summary["forecast_total"] == pytest.approx(200_000), (
        "прогноз посчитан по колонке progress_percent, а она всегда ноль"
    )


# --- то, что видел пользователь ----------------------------------------------


@pytest.mark.asyncio
async def test_a_project_with_no_spending_does_not_get_an_overrun_risk(db):
    """Воспроизводит «+18 754 332 ₽ к смете» на проекте, где не потрачено ничего."""
    project = await _seed(db, "zero", spent=0, stage_progress=[1, 0, 0, 0])
    # Загружаем ровно так, как это делает продовый маршрут /os/risks.
    loaded = await risk_engine.load_project_for_risks(db, project.id)
    risks = await risk_engine.compute_project_risks(db, loaded)

    budget_risks = [r for r in risks if r["kind"] == "budget"]
    assert budget_risks == [], (
        f"риск перерасхода на нулевых тратах: {budget_risks}"
    )


@pytest.mark.asyncio
async def test_a_real_overrun_is_still_reported(db):
    """Страховка от «молчать всегда»: настоящий перерасход обязан прозвучать."""
    project = await _seed(db, "over", spent=150_000, stage_progress=[50, 50, 50, 50])
    # Загружаем ровно так, как это делает продовый маршрут /os/risks.
    loaded = await risk_engine.load_project_for_risks(db, project.id)
    risks = await risk_engine.compute_project_risks(db, loaded)

    budget_risks = [r for r in risks if r["kind"] == "budget"]
    assert budget_risks, "факт 150 000 на половине работ — это прогноз 300 000 при плане 194 437"
    assert "18 754 332" not in str(budget_risks)
