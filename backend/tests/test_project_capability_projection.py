from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models.entities import UserRole
from app.services import project_capability_service as capabilities


def user(user_id: str, role: UserRole = UserRole.contractor):
    return SimpleNamespace(id=user_id, role=role)


def project(*, customer_id: str = "customer", contractor_id: str | None = "lead"):
    return SimpleNamespace(id="project", customer_id=customer_id, contractor_id=contractor_id)


@pytest.mark.asyncio
async def test_owner_and_lead_are_derived_from_project_authority(monkeypatch):
    async def no_membership(*_args, **_kwargs):
        return None

    async def no_supervisor(*_args, **_kwargs):
        return False

    monkeypatch.setattr(capabilities.team_service, "project_team_membership", no_membership)
    monkeypatch.setattr(capabilities.supervision, "is_active_supervisor", no_supervisor)

    owner = await capabilities.resolve_operational_context(
        None, user=user("customer", UserRole.customer), project=project()
    )
    lead = await capabilities.resolve_operational_context(
        None, user=user("lead"), project=project()
    )

    assert owner.persona == "owner"
    assert "acceptance.decide" in owner.capabilities
    assert owner.read_only is False
    assert lead.persona == "lead"
    assert "team.manage" in lead.capabilities
    assert "billing.issue" in lead.capabilities
    assert lead.read_only is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("team_role", "persona", "must_have", "read_only"),
    [
        ("foreman", "foreman", "schedule.manage", False),
        ("member", "member", "field.write", False),
        ("viewer", "guest", "project.read", True),
    ],
)
async def test_team_roles_project_to_operational_personas(
    monkeypatch, team_role, persona, must_have, read_only
):
    async def membership(*_args, **_kwargs):
        return SimpleNamespace(role=team_role)

    async def no_supervisor(*_args, **_kwargs):
        return False

    monkeypatch.setattr(capabilities.team_service, "project_team_membership", membership)
    monkeypatch.setattr(capabilities.supervision, "is_active_supervisor", no_supervisor)

    result = await capabilities.resolve_operational_context(
        None, user=user("worker"), project=project()
    )

    assert result.persona == persona
    assert must_have in result.capabilities
    assert result.read_only is read_only


@pytest.mark.asyncio
async def test_supervisor_projects_only_supervision_capabilities(monkeypatch):
    async def no_membership(*_args, **_kwargs):
        return None

    async def yes_supervisor(*_args, **_kwargs):
        return True

    monkeypatch.setattr(capabilities.team_service, "project_team_membership", no_membership)
    monkeypatch.setattr(capabilities.supervision, "is_active_supervisor", yes_supervisor)

    result = await capabilities.resolve_operational_context(
        None, user=user("supervisor"), project=project()
    )

    assert result.persona == "supervisor"
    assert set(result.capabilities) == {
        "communication.write",
        "project.read",
        "quality.issue",
        "quality.review",
        "schedule.review",
    }
    assert "schedule.manage" not in result.capabilities
    assert result.read_only is True


@pytest.mark.asyncio
async def test_scoped_participant_does_not_gain_full_project_management(monkeypatch):
    async def no_membership(*_args, **_kwargs):
        return None

    async def no_supervisor(*_args, **_kwargs):
        return False

    async def active_participant(*_args, **_kwargs):
        return SimpleNamespace(
            participant_role="contractor",
            can_manage_schedule=True,
            can_manage_commercial=False,
            can_manage_documents=True,
        )

    monkeypatch.setattr(capabilities.team_service, "project_team_membership", no_membership)
    monkeypatch.setattr(capabilities.supervision, "is_active_supervisor", no_supervisor)
    monkeypatch.setattr(capabilities.participant_svc, "active_participant", active_participant)

    result = await capabilities.resolve_operational_context(
        None, user=user("scoped"), project=project()
    )

    assert result.persona == "participant"
    assert "project.read_scoped" in result.capabilities
    assert "schedule.manage_scoped" in result.capabilities
    assert "documents.manage_scoped" in result.capabilities
    assert "commercial.manage_scoped" not in result.capabilities
    assert "project.manage" not in result.capabilities
    assert result.read_only is True


@pytest.mark.asyncio
async def test_explicit_project_viewer_projects_to_guest(monkeypatch):
    async def no_membership(*_args, **_kwargs):
        return None

    async def no_supervisor(*_args, **_kwargs):
        return False

    async def no_participant(*_args, **_kwargs):
        return None

    async def is_guest(*_args, **_kwargs):
        return True

    monkeypatch.setattr(capabilities.team_service, "project_team_membership", no_membership)
    monkeypatch.setattr(capabilities.supervision, "is_active_supervisor", no_supervisor)
    monkeypatch.setattr(capabilities.participant_svc, "active_participant", no_participant)
    monkeypatch.setattr(capabilities.team_service, "is_project_guest", is_guest)

    result = await capabilities.resolve_operational_context(
        None, user=user("guest", UserRole.customer), project=project()
    )

    assert result.persona == "guest"
    assert result.capabilities == ("project.read",)
    assert result.read_only is True
