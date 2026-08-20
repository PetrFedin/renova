from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

import app.models.technical_supervision  # noqa: F401
from app.api import deps
from app.api.v1 import technical_supervision_project_access as project_access_api
from app.models.entities import Project, Stage, Team, TeamMember, User, UserRole
from app.models.technical_supervision import ProjectTechnicalSupervisorAssignment
from app.services import technical_supervision_service as supervision


async def _no_dispatch(*_args, **_kwargs):
    return None


async def _user(
    db,
    suffix: str,
    *,
    role: UserRole,
    profile_code: str | None = None,
) -> User:
    tail = sum((index + 1) * ord(char) for index, char in enumerate(suffix)) % 10_000_000
    row = User(
        id=f"ts-user-{suffix}",
        phone=f"+7999{tail:07d}",
        role=role,
        full_name=f"User {suffix}",
        profile_code=profile_code,
    )
    db.add(row)
    await db.flush()
    return row


async def _project(
    db,
    suffix: str,
    *,
    customer: User,
    contractor: User | None = None,
) -> Project:
    row = Project(
        id=f"ts-project-{suffix}",
        name=f"Project {suffix}",
        renovation_type="capital",
        property_type="apartment",
        customer_id=customer.id,
        contractor_id=contractor.id if contractor else None,
    )
    db.add(row)
    await db.commit()
    return row


@pytest.mark.asyncio
async def test_appoint_replay_read_only_access_and_immediate_revoke(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer = await _user(db, "owner", role=UserRole.customer, profile_code="OWN001")
    contractor = await _user(db, "contractor", role=UserRole.contractor, profile_code="CTR001")
    representative = await _user(db, "supervisor", role=UserRole.contractor, profile_code="SUP001")
    project = await _project(db, "lifecycle", customer=customer, contractor=contractor)

    first = await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code="sup001",
        provider_type="company",
        provider_name="Independent QC LLC",
    )
    assert first.replayed is False
    assert first.assignment is not None
    assert first.assignment.representative_user_id == representative.id

    replay = await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code="SUP001",
        provider_type="company",
        provider_name="Independent QC LLC",
        expected_assignment_id=first.assignment.id,
    )
    assert replay.replayed is True
    assert replay.assignment is not None
    assert replay.assignment.id == first.assignment.id
    assert await db.scalar(
        select(func.count())
        .select_from(ProjectTechnicalSupervisorAssignment)
        .where(
            ProjectTechnicalSupervisorAssignment.project_id == project.id,
            ProjectTechnicalSupervisorAssignment.revoked_at.is_(None),
        )
    ) == 1

    readable = await deps.require_project(db, project.id, representative, write=False)
    assert readable.id == project.id
    with pytest.raises(HTTPException) as write_error:
        await deps.require_project(db, project.id, representative, write=True)
    assert write_error.value.status_code == 403

    mode, read_only, capabilities = await supervision.project_access_descriptor(
        db, user=representative, project=readable
    )
    assert mode == "supervisor"
    assert read_only is True
    assert set(capabilities) == set(supervision.SUPERVISOR_CAPABILITIES)

    revoked = await supervision.revoke(
        db,
        project_id=project.id,
        actor=customer,
        expected_assignment_id=first.assignment.id,
    )
    assert revoked.replayed is False
    with pytest.raises(HTTPException) as access_error:
        await deps.require_project(db, project.id, representative, write=False)
    assert access_error.value.status_code == 403


@pytest.mark.asyncio
async def test_replace_keeps_history_and_stale_client_cannot_revoke_new_assignment(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer = await _user(db, "replace-owner", role=UserRole.customer, profile_code="OWN002")
    first_rep = await _user(db, "replace-a", role=UserRole.customer, profile_code="SUPA02")
    second_rep = await _user(db, "replace-b", role=UserRole.contractor, profile_code="SUPB02")
    project = await _project(db, "replace", customer=customer)
    project_id = project.id

    first = await supervision.appoint_or_replace(
        db,
        project_id=project_id,
        actor=customer,
        profile_code=first_rep.profile_code or "",
        provider_type="individual",
        provider_name=None,
    )
    assert first.assignment is not None
    first_assignment_id = first.assignment.id
    second = await supervision.appoint_or_replace(
        db,
        project_id=project_id,
        actor=customer,
        profile_code=second_rep.profile_code or "",
        provider_type="company",
        provider_name="Second QC",
        expected_assignment_id=first_assignment_id,
    )
    assert second.assignment is not None
    second_assignment_id = second.assignment.id
    assert second.assignment.supersedes_assignment_id == first_assignment_id

    rows = await supervision.history(db, project_id)
    assert [row.id for row, _ in rows][:2] == [second_assignment_id, first_assignment_id]
    old = next(row for row, _ in rows if row.id == first_assignment_id)
    assert old.revoked_at is not None

    with pytest.raises(ValueError, match="technical_supervision_assignment_changed"):
        await supervision.revoke(
            db,
            project_id=project_id,
            actor=customer,
            expected_assignment_id=first_assignment_id,
        )
    current = await supervision.active_assignment(db, project_id)
    assert current is not None
    assert current.id == second_assignment_id


@pytest.mark.asyncio
async def test_database_enforces_single_active_assignment(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer = await _user(db, "unique-owner", role=UserRole.customer, profile_code="OWN003")
    rep_a = await _user(db, "unique-a", role=UserRole.customer, profile_code="SUPA03")
    rep_b = await _user(db, "unique-b", role=UserRole.contractor, profile_code="SUPB03")
    project = await _project(db, "unique", customer=customer)
    first = await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code=rep_a.profile_code or "",
        provider_type="individual",
        provider_name="A",
    )
    assert first.assignment is not None

    db.add(
        ProjectTechnicalSupervisorAssignment(
            project_id=project.id,
            representative_user_id=rep_b.id,
            provider_type="individual",
            provider_name="B",
            appointed_by_user_id=customer.id,
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


@pytest.mark.asyncio
async def test_conflicts_fail_closed_at_appointment_and_after_later_team_change(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer = await _user(db, "conflict-owner", role=UserRole.customer, profile_code="OWN004")
    contractor = await _user(db, "conflict-contractor", role=UserRole.contractor, profile_code="CTR004")
    member = await _user(db, "conflict-member", role=UserRole.contractor, profile_code="MEM004")
    independent = await _user(db, "conflict-independent", role=UserRole.contractor, profile_code="SUP004")
    project = await _project(db, "conflict", customer=customer, contractor=contractor)
    team = Team(id="ts-team-conflict", name="Crew", owner_id=contractor.id)
    db.add(team)
    db.add(TeamMember(team_id=team.id, user_id=contractor.id, role="owner"))
    db.add(TeamMember(team_id=team.id, user_id=member.id, role="foreman"))
    await db.commit()

    for code, expected in [
        (customer.profile_code, "technical_supervision_customer_conflict"),
        (contractor.profile_code, "technical_supervision_contractor_conflict"),
        (member.profile_code, "technical_supervision_contractor_team_conflict"),
    ]:
        with pytest.raises(ValueError, match=expected):
            await supervision.appoint_or_replace(
                db,
                project_id=project.id,
                actor=customer,
                profile_code=code or "",
                provider_type="individual",
                provider_name="Conflict",
            )

    appointed = await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code=independent.profile_code or "",
        provider_type="individual",
        provider_name="Independent",
    )
    assert appointed.assignment is not None
    assert await supervision.is_active_supervisor(
        db, project_id=project.id, user_id=independent.id
    )

    db.add(TeamMember(team_id=team.id, user_id=independent.id, role="viewer"))
    await db.commit()
    assert not await supervision.is_active_supervisor(
        db, project_id=project.id, user_id=independent.id
    )
    assert await supervision.list_supervised_projects(db, user_id=independent.id) == []


@pytest.mark.asyncio
async def test_supervisor_capabilities_are_explicit_and_financial_authority_is_denied(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer = await _user(db, "caps-owner", role=UserRole.customer, profile_code="OWN005")
    representative = await _user(db, "caps-supervisor", role=UserRole.contractor, profile_code="SUP005")
    project = await _project(db, "caps", customer=customer)
    await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code="SUP005",
        provider_type="individual",
        provider_name="Inspector",
    )

    for capability in supervision.SUPERVISOR_CAPABILITIES:
        assert await supervision.require_capability(
            db, user=representative, project=project, capability=capability
        ) == "supervisor"

    for forbidden in ("field_write", "schedule", "estimate_lock", "escalate", "payments"):
        with pytest.raises(HTTPException) as error:
            await supervision.require_capability(
                db, user=representative, project=project, capability=forbidden
            )
        assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_global_contractor_supervisor_reads_all_project_stages(db, monkeypatch):
    monkeypatch.setattr(supervision, "_dispatch", _no_dispatch)
    customer = await _user(db, "detail-owner", role=UserRole.customer, profile_code="OWN006")
    representative = await _user(db, "detail-supervisor", role=UserRole.contractor, profile_code="SUP006")
    another_contractor = await _user(db, "detail-worker", role=UserRole.contractor, profile_code="WRK006")
    project = await _project(db, "detail", customer=customer)
    db.add_all(
        [
            Stage(project_id=project.id, name="Visible A", sort_order=0, assignee_id=another_contractor.id),
            Stage(project_id=project.id, name="Visible B", sort_order=1, assignee_id=None),
        ]
    )
    await db.commit()
    await supervision.appoint_or_replace(
        db,
        project_id=project.id,
        actor=customer,
        profile_code="SUP006",
        provider_type="individual",
        provider_name="Inspector",
    )

    detail = await project_access_api.get_project(project.id, representative, db)
    assert detail.access_mode == "supervisor"
    assert detail.read_only is True
    assert {stage.name for stage in detail.stages} == {"Visible A", "Visible B"}
    assert set(detail.technical_capabilities) == set(supervision.SUPERVISOR_CAPABILITIES)
