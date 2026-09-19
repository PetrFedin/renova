"""Область работ участника должна что-то значить на маршрутах.

``scope_allows`` написана, покрыта тестами и отвечает верно — и не вызывается
ни из одного маршрута (grep по `app/` не находит ни одного потребителя вне
её собственного модуля). Заказчик добавляет субподрядчика на этап, сервис
согласен, что тот вправе на нём работать, а общий гейт объекта отсекает его
раньше, чем дело доходит до области.

Общий доступ к объекту у участника закрыт **намеренно** — это закреплено
тестами `test_independent_participant_is_scoped_but_generic_project_acl_stays_closed`
и `test_customer_management_api_preserves_generic_acl_boundary`, и здесь не
трогается. Проверяется ровно адресный вход: своя область открыта, чужая нет.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import require_project, require_project_scope
from app.db.base import Base
from app.models.entities import Project, Stage, StageStatus, User, UserRole
import app.models.outbox_runtime  # noqa: F401
from app.models.project_participants import ProjectParticipant, ProjectParticipantScope
import app.models.work_schedule  # noqa: F401
from app.services import team_service


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def stand(db):
    """Объект с ведущим исполнителем, субподрядчиком и двумя этапами."""
    customer = User(id="c-scope", phone="+79990008888", role=UserRole.customer)
    lead = User(id="k-lead-scope", phone="+78880008888", role=UserRole.contractor)
    sub = User(id="k-sub-scope", phone="+78880009999", role=UserRole.contractor)
    project = Project(
        id="p-scope",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=lead.id,
    )
    mine = Stage(
        id="s-mine",
        project_id=project.id,
        name="Электрика",
        sort_order=0,
        status=StageStatus.planned,
        payment_amount=1000,
        weight_coefficient=0.5,
    )
    theirs = Stage(
        id="s-theirs",
        project_id=project.id,
        name="Сантехника",
        sort_order=1,
        status=StageStatus.planned,
        payment_amount=1000,
        weight_coefficient=0.5,
    )
    db.add_all([customer, lead, sub, project, mine, theirs])
    await db.flush()
    participant = ProjectParticipant(
        project_id=project.id,
        user_id=sub.id,
        participant_role="contractor",
        status="active",
        all_scope=False,
        added_by=customer.id,
    )
    db.add(participant)
    await db.flush()
    db.add(
        ProjectParticipantScope(
            participant_id=participant.id,
            scope_type="stage",
            scope_ref=mine.id,
        )
    )
    await db.commit()
    return project, sub, mine, theirs, participant


@pytest.mark.asyncio
async def test_the_subcontractor_may_act_on_their_own_stage(db, stand):
    project, sub, mine, _theirs, _ = stand

    allowed = await require_project_scope(
        db, project.id, sub, stage_id=mine.id, write=True
    )

    assert allowed.id == project.id, (
        "субподрядчик не допущен к этапу, на который его сами же и добавили"
    )


@pytest.mark.asyncio
async def test_the_subcontractor_may_not_act_on_another_stage(db, stand):
    project, sub, _mine, theirs, _ = stand

    with pytest.raises(HTTPException) as denied:
        await require_project_scope(db, project.id, sub, stage_id=theirs.id, write=True)

    assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_a_stranger_gets_nothing(db, stand):
    """Адресный вход не должен открывать объект посторонним."""
    project, _sub, mine, _theirs, _ = stand
    stranger = User(id="k-stranger", phone="+78880001010", role=UserRole.contractor)
    db.add(stranger)
    await db.commit()

    with pytest.raises(HTTPException) as denied:
        await require_project_scope(db, project.id, stranger, stage_id=mine.id, write=True)

    assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_a_removed_participant_loses_the_scope(db, stand):
    project, sub, mine, _theirs, participant = stand
    participant.status = "removed"
    await db.commit()

    with pytest.raises(HTTPException) as denied:
        await require_project_scope(db, project.id, sub, stage_id=mine.id, write=True)

    assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_the_generic_boundary_is_not_weakened(db, stand):
    """Главное: общий доступ к объекту у участника остаётся закрытым."""
    project, sub, _mine, _theirs, _ = stand

    assert await team_service.can_access_project(db, sub, project, write=False) is False
    assert await team_service.can_access_project(db, sub, project, write=True) is False

    with pytest.raises(HTTPException) as denied:
        await require_project(db, project.id, sub, write=False)
    assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_the_lead_contractor_is_unaffected(db, stand):
    """Обычный путь владельца работ не должен измениться."""
    project, _sub, mine, _theirs, _ = stand
    lead = await db.get(User, project.contractor_id)

    allowed = await require_project_scope(
        db, project.id, lead, stage_id=mine.id, write=True
    )

    assert allowed.id == project.id


@pytest.mark.asyncio
async def test_the_customer_is_unaffected(db, stand):
    """Общий путь должен идти первым.

    `scope_allows` отвечает «нет» заказчику: он не участник и не назначенный
    исполнитель. Если проверять область раньше общего доступа, владелец
    объекта потеряет его молча.
    """
    project, _sub, mine, _theirs, _ = stand
    customer = await db.get(User, project.customer_id)

    allowed = await require_project_scope(
        db, project.id, customer, stage_id=mine.id, write=True
    )

    assert allowed.id == project.id, "владелец объекта потерял доступ"
