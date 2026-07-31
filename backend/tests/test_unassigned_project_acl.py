from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Project, ProjectViewer, Team, TeamMember, User, UserRole
from app.services import team_service as team_svc


@pytest_asyncio.fixture
async def acl_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed(acl_db):
    customer = User(id="acl-customer", phone="+79990001001", role=UserRole.customer)
    assigned = User(id="acl-assigned", phone="+79990001002", role=UserRole.contractor)
    member = User(id="acl-member", phone="+79990001003", role=UserRole.contractor)
    unrelated = User(id="acl-unrelated", phone="+79990001004", role=UserRole.contractor)
    guest = User(id="acl-guest", phone="+79990001005", role=UserRole.customer)
    assigned_project = Project(
        id="acl-assigned-project",
        name="Assigned",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=assigned.id,
    )
    unassigned_project = Project(
        id="acl-unassigned-project",
        name="Unassigned",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    team = Team(id="acl-team", name="Assigned team", owner_id=assigned.id)
    membership = TeamMember(
        id="acl-membership",
        team_id=team.id,
        user_id=member.id,
        role="viewer",
    )
    unrelated_team = Team(id="acl-other-team", name="Other", owner_id=unrelated.id)
    unrelated_membership = TeamMember(
        id="acl-other-membership",
        team_id=unrelated_team.id,
        user_id=member.id,
        role="member",
    )
    viewer = ProjectViewer(
        id="acl-project-viewer",
        project_id=unassigned_project.id,
        user_id=guest.id,
    )
    acl_db.add_all(
        [
            customer,
            assigned,
            member,
            unrelated,
            guest,
            assigned_project,
            unassigned_project,
            team,
            membership,
            unrelated_team,
            unrelated_membership,
            viewer,
        ]
    )
    await acl_db.commit()
    return {
        "customer": customer,
        "assigned": assigned,
        "member": member,
        "unrelated": unrelated,
        "guest": guest,
        "assigned_project": assigned_project,
        "unassigned_project": unassigned_project,
        "membership": membership,
    }


@pytest.mark.asyncio
async def test_unassigned_project_is_not_globally_visible_to_contractors(acl_db):
    data = await _seed(acl_db)
    project = data["unassigned_project"]

    assert await team_svc.project_access_mode(acl_db, data["assigned"], project) == (
        "none",
        True,
    )
    assert await team_svc.project_access_mode(acl_db, data["member"], project) == (
        "none",
        True,
    )
    assert await team_svc.project_access_mode(acl_db, data["unrelated"], project) == (
        "none",
        True,
    )
    assert await team_svc.can_access_project(acl_db, data["member"], project) is False
    assert await team_svc.can_access_project(
        acl_db,
        data["member"],
        project,
        write=True,
    ) is False
    assert await team_svc.team_role_for_project(acl_db, data["member"], project) is None

    with pytest.raises(HTTPException) as forbidden:
        await team_svc.require_capability(
            acl_db,
            data["member"],
            project,
            "field_write",
        )
    assert forbidden.value.status_code == 403
    assert forbidden.value.detail == "project_forbidden"


@pytest.mark.asyncio
async def test_only_assigned_contractor_team_members_inherit_access(acl_db):
    data = await _seed(acl_db)
    project = data["assigned_project"]

    assert await team_svc.project_access_mode(acl_db, data["assigned"], project) == (
        "contractor",
        False,
    )
    assert await team_svc.project_access_mode(acl_db, data["member"], project) == (
        "contractor",
        True,
    )
    assert await team_svc.team_role_for_project(acl_db, data["member"], project) == "viewer"
    assert await team_svc.can_access_project(acl_db, data["member"], project) is True
    assert await team_svc.can_access_project(
        acl_db,
        data["member"],
        project,
        write=True,
    ) is False
    assert await team_svc.project_access_mode(acl_db, data["unrelated"], project) == (
        "none",
        True,
    )


@pytest.mark.asyncio
async def test_membership_selection_is_scoped_to_assigned_owner_with_multiple_teams(acl_db):
    data = await _seed(acl_db)

    membership = await team_svc.project_team_membership(
        acl_db,
        user_id=data["member"].id,
        contractor_id=data["assigned"].id,
    )
    owners = await team_svc.team_owner_ids(acl_db, data["member"].id)

    assert membership is not None
    assert membership.id == data["membership"].id
    assert owners == {data["assigned"].id, data["unrelated"].id}


@pytest.mark.asyncio
async def test_customer_and_explicit_guest_access_remain_intact(acl_db):
    data = await _seed(acl_db)
    project = data["unassigned_project"]

    assert await team_svc.project_access_mode(acl_db, data["customer"], project) == (
        "owner",
        False,
    )
    assert await team_svc.project_access_mode(acl_db, data["guest"], project) == (
        "guest",
        True,
    )


def test_acl_source_has_no_unassigned_contractor_fallback():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "services" / "team_service.py").read_text(
        encoding="utf-8"
    )
    start = source.index("async def project_access_mode")
    end = source.index("async def is_contractor_owner", start)
    block = source[start:end]

    assert "project.contractor_id is None" not in block
    assert "project_team_membership" in block
    assert "my_membership" not in block
