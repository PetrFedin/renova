"""Подрядчик не может отключить технадзор, добавив его в свою бригаду.

`is_active_supervisor` → `_assert_independent`: проверяющий, состоящий в
бригаде проверяемого подрядчика, независимым не считается и теряет доступ к
проекту. Правило верное и намеренно fail-closed — конфликт интересов реален.

Но вход в это правило был подконтролен той стороне, которую оно ограничивает.
`POST /teams/invite` создавал членство молча, по одному номеру телефона,
который подрядчик знает: они встречаются на объекте. Маршрута на удаление
участника не было ни у кого, так что отменить это не мог никто — ни сам
технадзор, ни заказчик, который его нанял.

Здесь проверяется именно последствие, а не только «членство не создалось».
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import Project, Team, User, UserRole
from app.models.technical_supervision import (  # noqa: F401
    ProjectTechnicalSupervisorAssignment,
)
from app.services import team_service as team_svc
from app.services import technical_supervision_service as supervision


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _stand(db):
    """Заказчик, подрядчик, назначенный технадзор и бригада подрядчика."""
    customer = User(id="sv-customer", phone="+79100000001", role=UserRole.customer)
    contractor = User(id="sv-contractor", phone="+79100000002", role=UserRole.contractor)
    supervisor = User(
        id="sv-supervisor",
        phone="+79100000003",
        role=UserRole.contractor,
        profile_code="SVCODE1",
    )
    project = Project(
        id="sv-project",
        name="Объект под надзором",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, supervisor, project])
    await db.commit()

    await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code="SVCODE1",
        provider_type="individual",
        provider_name="Независимый технадзор",
    )
    team = await team_svc.create_team(db, contractor.id, "Бригада")
    return {
        "customer": customer,
        "contractor": contractor,
        "supervisor": supervisor,
        "project": project,
        "team": team,
    }


@pytest.mark.asyncio
async def test_the_supervisor_keeps_access_after_a_phone_invitation(db):
    """Эскалация целиком: приглашение → доступ технадзора должен уцелеть."""
    stand = await _stand(db)

    assert await supervision.is_active_supervisor(
        db, project_id=stand["project"].id, user_id=stand["supervisor"].id
    ), "технадзор не получил доступ даже до приглашения — стенд собран неверно"

    result = await team_svc.invite_phone_as_owner(
        db,
        owner_id=stand["contractor"].id,
        phone=stand["supervisor"].phone,
        role="member",
    )
    assert result.get("ok") is True

    assert await supervision.is_active_supervisor(
        db, project_id=stand["project"].id, user_id=stand["supervisor"].id
    ), "подрядчик отключил технадзор одним приглашением"


@pytest.mark.asyncio
async def test_the_independence_rule_itself_still_works(db):
    """Страховка: правило не должно быть ослаблено.

    Если технадзор действительно вступил в бригаду — сам, по своей воле, —
    независимым он быть перестаёт. Без этого теста предыдущий проходил бы и
    при полностью выключенной проверке конфликта.
    """
    stand = await _stand(db)

    await team_svc.ensure_team_membership(
        db,
        team_id=stand["team"].id,
        user_id=stand["supervisor"].id,
        role="member",
    )
    await db.commit()

    assert not await supervision.is_active_supervisor(
        db, project_id=stand["project"].id, user_id=stand["supervisor"].id
    ), "конфликт интересов перестал учитываться"


@pytest.mark.asyncio
async def test_leaving_the_brigade_restores_independence(db):
    """Выход из бригады возвращает доступ — иначе правило было бы ловушкой."""
    stand = await _stand(db)

    await team_svc.ensure_team_membership(
        db,
        team_id=stand["team"].id,
        user_id=stand["supervisor"].id,
        role="member",
    )
    await db.commit()
    assert not await supervision.is_active_supervisor(
        db, project_id=stand["project"].id, user_id=stand["supervisor"].id
    )

    left = await team_svc.leave_team(db, user_id=stand["supervisor"].id)
    assert left.get("ok") is True, left

    assert await supervision.is_active_supervisor(
        db, project_id=stand["project"].id, user_id=stand["supervisor"].id
    ), "выйдя из бригады, технадзор не вернул себе независимость"
