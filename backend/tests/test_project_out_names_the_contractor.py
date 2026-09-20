"""Ответ о проекте должен называть исполнителя.

Найдено проходом демо как клиент: объект создан из заявки, исполнитель
закреплён (в базе `projects.contractor_id` заполнен), а экран «Комнаты»
показывает «Исполнитель не подключён» и предлагает его подключить.

Причина: в `ProjectOut` поля `contractor_id` не было вовсе. Приложение
ветвится по нему в семи местах — от этой плашки до правила «после подключения
изменения только через запрос», — и на всех объектах читало `undefined`, то
есть «исполнителя нет».

Живой замер до правки: у двух объектов из четырёх исполнитель закреплён, а
ответ отдавал `None` по всем четырём.
"""
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.api.v1.projects import _project_out
from app.db.base import Base
from app.models.entities import Project, User, UserRole
from app.schemas.project import ProjectDetail, ProjectOut
import app.models.client_write_request  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.work_schedule  # noqa: F401

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def project_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(db, *, with_contractor: bool):
    customer = User(id=f"po-cust-{with_contractor}", phone=f"+7999100000{int(with_contractor)}", role=UserRole.customer)
    contractor = User(id=f"po-contr-{with_contractor}", phone=f"+7999200000{int(with_contractor)}", role=UserRole.contractor)
    project = Project(
        id=f"po-project-{with_contractor}",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id if with_contractor else None,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    # `_project_out` читает связи проекта; в бою они приходят предзагруженными.
    loaded = await db.scalar(
        select(Project)
        .where(Project.id == project.id)
        .options(
            selectinload(Project.payments),
            selectinload(Project.rooms),
            selectinload(Project.stages),
        )
    )
    return loaded, contractor


def test_schema_declares_the_field():
    assert "contractor_id" in ProjectOut.model_fields
    # Детальный ответ наследует тот же набор полей.
    assert "contractor_id" in ProjectDetail.model_fields


async def test_attached_contractor_is_named(project_db):
    project, contractor = await seed(project_db, with_contractor=True)
    out = _project_out(project)
    assert out.contractor_id == contractor.id


async def test_project_without_contractor_stays_empty(project_db):
    project, _ = await seed(project_db, with_contractor=False)
    out = _project_out(project)
    assert out.contractor_id is None


async def test_previous_fields_are_untouched(project_db):
    # Правка аддитивная: остальной ответ прежний.
    project, _ = await seed(project_db, with_contractor=True)
    out = _project_out(project)
    assert out.id == project.id
    assert out.name == "Объект"
    assert out.access_mode == "owner"
    assert out.technical_capabilities == []
