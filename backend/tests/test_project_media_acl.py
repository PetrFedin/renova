"""#449: project media (upload-url / read / presign) must be scoped to project ACL.

Repro before the fix: `POST /media/upload-url` minted `photos/<uuid>.jpg` after
auth only (no project binding); `GET /media/{key}` served `photos/*` with zero
ACL check at all — any authenticated (or even unauthenticated) caller could
read another project's stage photo / design package / floor plan / QC photo by
guessing or observing the key. This test drives the ACL layer directly
(`assert_project_media_access`, `assert_project_media_write_access`,
`mint_project_media_key`) the same way `app/api/v1/media.py` now does.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.entities import (
    ContractorPortfolioPhoto,
    ContractorProfile,
    DesignPackage,
    FloorPlan,
    Project,
    ProjectIssue,
    Stage,
    StagePhoto,
    User,
    UserRole,
)
from app.services.document_media_acl import (
    assert_project_media_access,
    assert_project_media_write_access,
    mint_project_media_key,
    parse_project_media_key,
)


async def _seed_two_projects(db):
    owner_a = User(id="pma-owner-a", phone="+79990000001", role=UserRole.customer)
    owner_b = User(id="pma-owner-b", phone="+79990000002", role=UserRole.customer)
    outsider = User(id="pma-outsider", phone="+79990000003", role=UserRole.customer)
    project_a = Project(
        id="pma-project-a",
        name="A",
        renovation_type="cosmetic",
        customer_id=owner_a.id,
    )
    project_b = Project(
        id="pma-project-b",
        name="B",
        renovation_type="cosmetic",
        customer_id=owner_b.id,
    )
    db.add_all([owner_a, owner_b, outsider, project_a, project_b])
    await db.commit()
    return owner_a, owner_b, outsider, project_a, project_b


def test_parse_project_media_key():
    pid = "1a53458d-2e03-4912-bf41-8e8ca8d097a1"
    parsed = parse_project_media_key(f"project-media/{pid}/foo.jpg")
    assert parsed is not None
    assert parsed.project_id == pid
    assert parsed.relative_path == "foo.jpg"
    assert parse_project_media_key("photos/foo.jpg") is None
    assert parse_project_media_key("project-media/") is None
    assert parse_project_media_key("project-media/only-id") is None


def test_mint_project_media_key_preserves_extension_and_scope():
    key = mint_project_media_key("proj-1", "pdf")
    assert key.startswith("project-media/proj-1/")
    assert key.endswith(".pdf")
    # Unsafe/unexpected extension input falls back to jpg rather than injecting.
    assert mint_project_media_key("proj-1", "../../etc").endswith(".jpg")


@pytest.mark.asyncio
async def test_upload_url_write_authority_is_scoped_to_project(db):
    owner_a, owner_b, outsider, project_a, project_b = await _seed_two_projects(db)

    # Owner may mint a key for their own project.
    await assert_project_media_write_access(db, owner_a, project_a.id)

    # A different account cannot mint a key scoped to someone else's project.
    with pytest.raises(HTTPException) as exc:
        await assert_project_media_write_access(db, owner_b, project_a.id)
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc:
        await assert_project_media_write_access(db, outsider, project_a.id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_canonical_project_media_key_read_is_project_scoped(db):
    owner_a, owner_b, outsider, project_a, project_b = await _seed_two_projects(db)
    key = mint_project_media_key(project_a.id, "jpg")

    # Owner can read their own project's key.
    resolved = await assert_project_media_access(db, owner_a, key, write=False)
    assert resolved == project_a.id

    # Unrelated accounts get privacy 404 for a foreign project-media key.
    for user in (owner_b, outsider):
        with pytest.raises(HTTPException) as exc:
            await assert_project_media_access(db, user, key, write=False)
        assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_legacy_photo_key_resolves_to_owning_project_and_blocks_foreign_users(db):
    """Repro of the original #449 bug: a pre-fix `photos/<uuid>.jpg` key,
    referenced only by a StagePhoto row, must now be gated by that stage's
    project ACL instead of being universally readable.
    """
    owner_a, owner_b, outsider, project_a, project_b = await _seed_two_projects(db)
    stage = Stage(id="pma-stage-1", project_id=project_a.id, name="Демонтаж")
    legacy_key = "photos/legacy-owner-a.jpg"
    photo = StagePhoto(id="pma-photo-1", stage_id=stage.id, user_id=owner_a.id, storage_key=legacy_key)
    db.add_all([stage, photo])
    await db.commit()

    resolved = await assert_project_media_access(db, owner_a, legacy_key, write=False)
    assert resolved == project_a.id

    for user in (owner_b, outsider):
        with pytest.raises(HTTPException) as exc:
            await assert_project_media_access(db, user, legacy_key, write=False)
        assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_legacy_floor_plan_and_design_package_keys_are_project_scoped(db):
    owner_a, owner_b, outsider, project_a, project_b = await _seed_two_projects(db)
    plan = FloorPlan(id="pma-plan-1", project_id=project_a.id, name="Этаж 1", image_key="plans/legacy.jpg")
    package = DesignPackage(id="pma-pkg-1", project_id=project_a.id, title="Проект", file_key="photos/legacy-design.pdf")
    issue = ProjectIssue(id="pma-issue-1", project_id=project_a.id, title="Скол", photo_key="issues/legacy-qc.jpg")
    db.add_all([plan, package, issue])
    await db.commit()

    for key in (plan.image_key, package.file_key, issue.photo_key):
        assert await assert_project_media_access(db, owner_a, key, write=False) == project_a.id
        with pytest.raises(HTTPException) as exc:
            await assert_project_media_access(db, owner_b, key, write=False)
        assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_unreferenced_legacy_key_fails_closed(db):
    owner_a, owner_b, outsider, project_a, project_b = await _seed_two_projects(db)
    with pytest.raises(HTTPException) as exc:
        await assert_project_media_access(db, owner_a, "photos/never-referenced.jpg", write=False)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_contractor_portfolio_photo_stays_open_to_any_authenticated_user(db):
    """Marketplace portfolio photos are intentionally not project-scoped — #449
    must not turn them into a fail-closed 404 for every other logged-in user.
    """
    owner_a, owner_b, outsider, project_a, project_b = await _seed_two_projects(db)
    profile = ContractorProfile(id="pma-profile-1", user_id=owner_a.id)
    photo = ContractorPortfolioPhoto(id="pma-portfolio-1", profile_id=profile.id, image_key="photos/portfolio.jpg")
    db.add_all([profile, photo])
    await db.commit()

    # No project binding, so the resolved project id is None — but access is
    # granted (not raised) to any authenticated caller.
    resolved = await assert_project_media_access(db, outsider, photo.image_key, write=False)
    assert resolved is None
