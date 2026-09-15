from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.v1 import design_packages as design_api
from app.api.v1 import floor_plans as floor_api
from app.api.v1 import media as media_api
from app.models.entities import (
    DesignPackage,
    FloorPlan,
    Project,
    ProjectIssue,
    Stage,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
)
from app.services import issue_service, project_media_acl, stage_service


async def seed_media_projects(db):
    customer = User(id="media-customer", phone="+79990001001", role=UserRole.customer)
    contractor = User(id="media-contractor", phone="+79990001002", role=UserRole.contractor)
    outsider = User(id="media-outsider", phone="+79990001003", role=UserRole.customer)
    project_a = Project(
        id="media-project-a",
        name="Media A",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    project_b = Project(
        id="media-project-b",
        name="Media B",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage_a = Stage(
        id="media-stage-a",
        project_id=project_a.id,
        name="Stage A",
        sort_order=0,
        status=StageStatus.planned,
    )
    db.add_all([customer, contractor, outsider, project_a, project_b, stage_a])
    await db.commit()
    return customer, contractor, outsider, project_a, project_b, stage_a


def test_parse_project_media_key_is_fail_closed():
    parsed = project_media_acl.parse_project_media_key(
        "project-media/media-project-a/abc.pdf"
    )
    assert parsed is not None
    assert parsed.project_id == "media-project-a"
    assert parsed.relative_path == "abc.pdf"

    assert project_media_acl.parse_project_media_key("photos/abc.jpg") is None
    assert project_media_acl.parse_project_media_key("project-media/media-project-a") is None
    assert project_media_acl.parse_project_media_key("project-media/media-project-a/../x") is None
    assert project_media_acl.parse_project_media_key("/project-media/media-project-a/x") is None


@pytest.mark.asyncio
async def test_upload_intent_is_project_scoped_and_read_acl_is_private(db, monkeypatch):
    customer, _, outsider, project_a, _, _ = await seed_media_projects(db)
    monkeypatch.setattr(media_api, "_presigned_put", lambda key, content_type: f"https://put.invalid/{key}?type={content_type}")

    response = await media_api.upload_url(
        media_api.UploadUrlIn(
            project_id=project_a.id,
            content_type="application/pdf",
            filename="design-v1.pdf",
        ),
        user=customer,
        db=db,
    )
    key = response["key"]
    assert key.startswith(f"project-media/{project_a.id}/")
    assert key.endswith(".pdf")
    assert response["content_type"] == "application/pdf"
    assert "application/pdf" in response["upload_url"]

    parsed = await project_media_acl.assert_project_media_access(
        db, customer, key, write=False
    )
    assert parsed.project_id == project_a.id

    with pytest.raises(HTTPException) as denied:
        await project_media_acl.assert_project_media_access(
            db, outsider, key, write=False
        )
    assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_same_user_cannot_attach_project_b_media_to_project_a_mutations(db):
    customer, contractor, _, project_a, project_b, stage_a = await seed_media_projects(db)
    key_b = f"project-media/{project_b.id}/foreign.jpg"

    # The actor may access both projects. Rejection therefore proves path-project binding.
    with pytest.raises(HTTPException) as stage_denied:
        await stage_service.add_photo(
            db,
            stage_a.id,
            contractor.id,
            None,
            "foreign",
            storage_key=key_b,
        )
    assert stage_denied.value.status_code == 404

    with pytest.raises(HTTPException) as issue_denied:
        await issue_service.create_issue(
            db,
            project_a.id,
            "Foreign photo",
            photo_key=key_b,
        )
    assert issue_denied.value.status_code == 404

    with pytest.raises(HTTPException) as plan_denied:
        await floor_api.create_plan(
            project_a.id,
            floor_api.PlanIn(name="Plan", image_key=key_b),
            user=customer,
            db=db,
        )
    assert plan_denied.value.status_code == 404

    with pytest.raises(HTTPException) as design_denied:
        await design_api.create_design(
            project_a.id,
            design_api.DesignIn(title="Design", file_key=key_b),
            user=contractor,
            db=db,
        )
    assert design_denied.value.status_code == 404

    assert await db.get(StagePhoto, "foreign") is None


@pytest.mark.asyncio
async def test_same_project_media_attaches_to_stage_issue_plan_and_design(db):
    customer, contractor, _, project_a, _, stage_a = await seed_media_projects(db)
    key = f"project-media/{project_a.id}/same-project.jpg"

    stage_photo = await stage_service.add_photo(
        db,
        stage_a.id,
        contractor.id,
        None,
        "До работ",
        storage_key=key,
    )
    assert stage_photo.storage_key == key

    issue = await issue_service.create_issue(
        db,
        project_a.id,
        "QC",
        photo_key=key,
    )
    assert issue.photo_key == key

    plan = await floor_api.create_plan(
        project_a.id,
        floor_api.PlanIn(name="Plan", image_key=key),
        user=customer,
        db=db,
    )
    assert plan["image_key"] == key

    design = await design_api.create_design(
        project_a.id,
        design_api.DesignIn(title="Design", file_key=key),
        user=contractor,
        db=db,
    )
    assert design["file_key"] == key


@pytest.mark.asyncio
async def test_legacy_project_media_resolves_only_through_unique_persisted_reference(db):
    customer, _, outsider, project_a, project_b, stage_a = await seed_media_projects(db)
    legacy_key = "photos/legacy-stage.jpg"
    db.add(
        StagePhoto(
            id="legacy-stage-photo",
            stage_id=stage_a.id,
            user_id=customer.id,
            storage_key=legacy_key,
            image_url=f"/api/v1/media/{legacy_key}",
        )
    )
    await db.commit()

    resolved = await project_media_acl.assert_legacy_project_media_access(
        db, customer, legacy_key
    )
    assert resolved == project_a.id

    with pytest.raises(HTTPException) as denied:
        await project_media_acl.assert_legacy_project_media_access(
            db, outsider, legacy_key
        )
    assert denied.value.status_code == 404

    with pytest.raises(HTTPException) as missing:
        await project_media_acl.assert_legacy_project_media_access(
            db, customer, "photos/unreferenced.jpg"
        )
    assert missing.value.status_code == 404

    # Ambiguous legacy reference must fail closed even when the same user owns both projects.
    db.add(
        FloorPlan(
            id="legacy-plan-b",
            project_id=project_b.id,
            name="Legacy B",
            image_key=legacy_key,
        )
    )
    await db.commit()
    with pytest.raises(HTTPException) as ambiguous:
        await project_media_acl.assert_legacy_project_media_access(
            db, customer, legacy_key
        )
    assert ambiguous.value.status_code == 404


@pytest.mark.asyncio
async def test_legacy_design_floor_and_issue_references_are_private(db):
    customer, _, outsider, project_a, _, _ = await seed_media_projects(db)
    legacy_design = "photos/legacy-design.pdf"
    legacy_plan = "photos/legacy-plan.jpg"
    legacy_issue = "photos/legacy-issue.jpg"
    db.add_all(
        [
            DesignPackage(
                id="legacy-design",
                project_id=project_a.id,
                title="Legacy",
                version=1,
                file_key=legacy_design,
                status="draft",
            ),
            FloorPlan(
                id="legacy-plan",
                project_id=project_a.id,
                name="Legacy",
                image_key=legacy_plan,
            ),
            ProjectIssue(
                id="legacy-issue",
                project_id=project_a.id,
                title="Legacy issue",
                severity="medium",
                status="open",
                photo_key=legacy_issue,
            ),
        ]
    )
    await db.commit()

    for key in (legacy_design, legacy_plan, legacy_issue):
        assert await project_media_acl.assert_legacy_project_media_access(
            db, customer, key
        ) == project_a.id
        with pytest.raises(HTTPException) as denied:
            await project_media_acl.assert_legacy_project_media_access(
                db, outsider, key
            )
        assert denied.value.status_code == 404
