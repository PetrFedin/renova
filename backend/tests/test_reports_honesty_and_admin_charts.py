"""MKT-018/019/020/032: честные отчёты, 422 на дату, остаток бюджета, платформенные графики."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import EstimateLine, Expense, LineType, MarginSnapshot, Project, Stage, StageStatus, User, UserRole


async def _call(db, actor, method, url, **kw):
    await db.refresh(actor)

    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.request(method, url, **kw)
    finally:
        app.dependency_overrides.clear()


async def _seed(db, *, stage_status=None, spent=0.0):
    ctr = User(id="rp-ctr", phone="+79990011001", role=UserRole.contractor)
    cust = User(id="rp-cust", phone="+79990011002", role=UserRole.customer)
    project = Project(id="rp-proj", name="Кв", renovation_type="cosmetic", customer_id=cust.id,
                      contractor_id=ctr.id, budget_planned=34465.1, budget_spent=spent)
    db.add_all([ctr, cust, project])
    db.add(EstimateLine(id="rp-l1", project_id=project.id, line_type=LineType.material, name="М", unit="шт",
                        quantity_planned=1, unit_price=34465.1))
    if spent:
        db.add(Expense(id="rp-e1", project_id=project.id, title="Чек", amount=spent, status="confirmed"))
    if stage_status is not None:
        db.add(Stage(id="rp-s1", project_id=project.id, name="A", sort_order=0, status=stage_status))
    await db.commit()
    return ctr, cust


@pytest.mark.asyncio
async def test_daily_bad_day_is_422_and_pdf_honors_day(db):
    ctr, _ = await _seed(db)
    for url in ("/api/v1/projects/rp-proj/reports/daily?day=garbage",
                "/api/v1/projects/rp-proj/reports/daily.pdf?day=2026-13-40"):
        r = await _call(db, ctr, "GET", url)
        assert r.status_code == 422, (url, r.text)
        assert r.json()["detail"]["code"] == "invalid_day"
    ok = await _call(db, ctr, "GET", "/api/v1/projects/rp-proj/reports/daily?day=2026-01-02")
    assert ok.status_code == 200 and ok.json()["date"] == "2026-01-02"
    pdf = await _call(db, ctr, "GET", "/api/v1/projects/rp-proj/reports/daily.pdf?day=2026-01-02")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")


@pytest.mark.asyncio
async def test_new_project_has_no_savings_and_report_is_preliminary(db):
    ctr, _ = await _seed(db, stage_status=StageStatus.planned, spent=0.0)
    r = await _call(db, ctr, "GET", "/api/v1/projects/rp-proj/reports/final")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["savings"] is None  # не весь бюджет «экономии»
    assert body["is_preliminary"] is True
    assert body["budget_planned"] == pytest.approx(34465.1)


@pytest.mark.asyncio
async def test_finished_project_with_fact_reports_savings(db):
    ctr, _ = await _seed(db, stage_status=StageStatus.done, spent=30000.0)
    body = (await _call(db, ctr, "GET", "/api/v1/projects/rp-proj/reports/final")).json()
    assert body["is_preliminary"] is False
    assert body["savings"] == pytest.approx(4465.1)


@pytest.mark.asyncio
async def test_finished_without_fact_has_no_savings(db):
    ctr, _ = await _seed(db, stage_status=StageStatus.done, spent=0.0)
    body = (await _call(db, ctr, "GET", "/api/v1/projects/rp-proj/reports/final")).json()
    assert body["is_preliminary"] is False and body["savings"] is None


@pytest.mark.asyncio
async def test_kpi_snapshot_is_contractor_only_daily_and_named_remaining(db):
    ctr, cust = await _seed(db, spent=1000.0)
    denied = await _call(db, cust, "POST", "/api/v1/projects/rp-proj/kpi-snapshot")
    assert denied.status_code == 403
    one = await _call(db, ctr, "POST", "/api/v1/projects/rp-proj/kpi-snapshot")
    two = await _call(db, ctr, "POST", "/api/v1/projects/rp-proj/kpi-snapshot")
    assert one.json()["remaining"] == pytest.approx(33465.1) and two.status_code == 200
    rows = (await db.scalars(select(MarginSnapshot))).all()
    assert len(rows) == 1  # повтор в те же сутки обновляет, а не копит
    hist = (await _call(db, ctr, "GET", "/api/v1/projects/rp-proj/kpi-history")).json()
    assert list(hist[0]) == ["remaining", "at"]


@pytest.mark.asyncio
async def test_admin_charts_cover_whole_platform_without_personal_names(db):
    admin = User(id="ch-admin", phone="+79990012001", role=UserRole.contractor)
    other = User(id="ch-other", phone="+79990012002", role=UserRole.contractor)
    cust = User(id="ch-cust", phone="+79990012003", role=UserRole.customer)
    db.add_all([
        admin, other, cust,
        # у админа как исполнителя проектов нет; у постороннего — два
        Project(id="ch-p1", name="Секретный адрес 1", renovation_type="cosmetic", customer_id=cust.id,
                contractor_id=other.id, budget_planned=1000),
        Project(id="ch-p2", name="Секретный адрес 2", renovation_type="capital", customer_id=cust.id,
                contractor_id=other.id, budget_planned=3000),
    ])
    await db.commit()
    db.add(Stage(id="ch-s1", project_id="ch-p1", name="A", sort_order=0, status=StageStatus.done, percent_complete=100))
    await db.commit()
    charts = (await _call(db, admin, "GET", "/api/v1/admin/projects-chart")).json()
    assert {c["name"] for c in charts} == {"cosmetic", "capital"}
    assert next(c for c in charts if c["name"] == "cosmetic")["done"] == 1
    rev = (await _call(db, admin, "GET", "/api/v1/admin/revenue-chart")).json()
    assert {r["name"]: r["planned"] for r in rev} == {"cosmetic": 1000, "capital": 3000}
    assert "Секретный" not in str(charts) + str(rev)
