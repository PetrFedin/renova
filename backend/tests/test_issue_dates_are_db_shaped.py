"""Замечания не создавались и не закрывались на Postgres.

`issue_service` писал в колонки `due_at`/`closed_at` значения с таймзоной,
а колонки объявлены как naive `DateTime`. На SQLite такая вставка проходит,
на Postgres драйвер отвечает:

    asyncpg.exceptions.DataError: invalid input for query argument $10
    can't subtract offset-naive and offset-aware datetimes

То есть локальные тесты были зелёными, а на живом стенде
`POST /projects/{id}/issues` стабильно отдавал 500, и закрыть замечание
было нельзя вовсе.

Проверка ловит именно это расхождение, не требуя Postgres: она смотрит на
форму значения, которую Postgres и проверяет. Плюс следит за источником —
в репозитории для этого есть `app.core.timeutil.utc_now`, и `issue_service`
был единственным местом, где его обходили.
"""

from pathlib import Path

import pytest

from app.models.entities import Project, ProjectIssue, User, UserRole
from app.services import issue_service

pytestmark = pytest.mark.asyncio


async def _project(db, suffix: str) -> tuple[Project, User]:
    customer = User(phone=f"+7999333{suffix}", role=UserRole.customer, full_name="Заказчик")
    db.add(customer)
    await db.flush()
    project = Project(
        name=f"Замечания {suffix}",
        renovation_type="capital",
        property_type="apartment",
        customer_id=customer.id,
    )
    db.add(project)
    await db.flush()
    return project, customer


async def test_created_issue_keeps_db_shaped_dates(db):
    project, _ = await _project(db, "01")

    issue = await issue_service.create_issue(
        db,
        project_id=project.id,
        title="Трещина в стене",
    )

    assert issue.title == "Трещина в стене"
    assert issue.status == "open"
    assert issue.due_at is not None
    # Postgres отвергает значение с таймзоной в колонке без неё — именно на
    # этом создание замечания и падало.
    assert issue.due_at.tzinfo is None, "due_at со смещением — на Postgres это 500"
    assert issue.created_at.tzinfo is None


async def test_closing_issue_keeps_db_shaped_dates(db):
    """Значение проверяется до записи — после неё SQLite отдаёт его уже naive.

    Именно поэтому дефект и дожил до стенда: на SQLite `db.refresh` возвращает
    значение без смещения, и любая проверка после коммита выглядит зелёной.
    Postgres же отвергает исходное значение прямо на вставке. `commit=False`
    оставляет то, что положил сервис, — ровно то, что увидит драйвер.
    """
    project, _ = await _project(db, "02")
    issue = await issue_service.create_issue(db, project_id=project.id, title="Скол плитки")

    await issue_service.transition_issue(db, issue, "fixed", UserRole.contractor, commit=False)
    await issue_service.transition_issue(db, issue, "closed", UserRole.customer, commit=False)

    assert issue.status == "closed"
    assert issue.closed_at is not None
    assert issue.closed_at.tzinfo is None, "closed_at со смещением — на Postgres это 500"

    await db.commit()
    await db.refresh(issue)
    assert issue.status == "closed"


async def test_issue_is_readable_back_from_the_database(db):
    project, _ = await _project(db, "03")
    created = await issue_service.create_issue(
        db,
        project_id=project.id,
        title="Не закрыт короб",
        description="Короб в санузле остался открытым",
        severity="high",
    )

    fetched = await db.get(ProjectIssue, created.id)
    assert fetched is not None
    assert fetched.title == "Не закрыт короб"
    assert fetched.description == "Короб в санузле остался открытым"
    assert fetched.severity == "high"
    assert fetched.project_id == project.id


@pytest.mark.filterwarnings("ignore::pytest.PytestWarning")
def test_issue_service_uses_the_repository_clock():
    """Источник времени один на весь репозиторий — `utc_now`.

    Прямой `datetime.now(timezone.utc)` здесь и был причиной: он отдаёт
    значение со смещением, а колонки его не принимают.
    """
    src = Path(issue_service.__file__).read_text(encoding="utf-8")
    # Комментарии выкидываем, иначе проверка ловит собственное пояснение.
    code = "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("#")
    )
    assert "datetime.now(timezone.utc)" not in code, (
        "issue_service снова берёт время со смещением — на Postgres это 500"
    )
    assert "utc_now()" in code
