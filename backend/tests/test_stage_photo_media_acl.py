"""P0: project photo bytes must never escape the owning project ACL."""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from app.api.v1.media import get_media
from app.models.entities import Project, ProjectIssue, Stage, StagePhoto, User, UserRole
from app.services import storage_service
from app.services.issue_service import issue_dict
from app.services.stage_photo_media_acl import (
    assert_stage_photo_media_access,
    issue_stage_photo_ticket,
    project_photo_media_url,
    stage_photo_media_url,
    validate_stage_photo_ticket,
)

pytestmark = pytest.mark.asyncio


async def _fixture(db):
    customer = User(phone="+79990002001", role=UserRole.customer, full_name="Photo Customer")
    contractor = User(phone="+79990002002", role=UserRole.contractor, full_name="Photo Contractor")
    outsider = User(phone="+79990002003", role=UserRole.customer, full_name="Photo Outsider")
    db.add_all([customer, contractor, outsider])
    await db.flush()

    project = Project(
        name="Private photo project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    outsider_project = Project(
        name="Other project",
        renovation_type="cosmetic",
        customer_id=outsider.id,
    )
    db.add_all([project, outsider_project])
    await db.flush()

    stage = Stage(project_id=project.id, name="Private stage")
    db.add(stage)
    await db.flush()
    photo = StagePhoto(
        stage_id=stage.id,
        user_id=contractor.id,
        caption="private",
        storage_key="photos/private-stage-photo.jpg",
        image_url="https://legacy.invalid/private-stage-photo.jpg",
    )
    issue = ProjectIssue(
        project_id=project.id,
        title="Private QC issue",
        status="open",
        severity="medium",
        photo_key="photos/private-issue-photo.jpg",
    )
    db.add_all([photo, issue])
    await db.commit()
    await db.refresh(photo)
    await db.refresh(issue)
    return customer, contractor, outsider, project, stage, photo, issue


async def test_project_photo_media_acl_allows_members_and_hides_from_outsider(db):
    customer, contractor, outsider, project, _, photo, issue = await _fixture(db)

    assert await assert_stage_photo_media_access(db, customer, photo.storage_key) == project.id
    assert await assert_stage_photo_media_access(db, contractor, photo.storage_key) == project.id
    assert await assert_stage_photo_media_access(db, customer, issue.photo_key) == project.id
    assert await assert_stage_photo_media_access(db, contractor, issue.photo_key) == project.id

    for key in (photo.storage_key, issue.photo_key):
        with pytest.raises(HTTPException) as exc_info:
            await assert_stage_photo_media_access(db, outsider, key)
        assert exc_info.value.status_code == 404


async def test_project_photo_ticket_is_short_lived_and_bound_to_exact_storage_key(db):
    _, _, _, _, _, photo, _ = await _fixture(db)
    expires, signature = issue_stage_photo_ticket(photo.storage_key, now=1_000, ttl_sec=300)

    assert expires == 1_300
    assert validate_stage_photo_ticket(
        photo.storage_key,
        expires=expires,
        signature=signature,
        now=1_299,
    )
    assert not validate_stage_photo_ticket(
        photo.storage_key,
        expires=expires,
        signature=signature,
        now=1_301,
    )
    assert not validate_stage_photo_ticket(
        "photos/another-project.jpg",
        expires=expires,
        signature=signature,
        now=1_100,
    )


async def test_stage_and_issue_read_models_emit_signed_media_urls(db):
    _, _, _, _, _, photo, issue = await _fixture(db)

    stage_url = stage_photo_media_url(photo)
    assert stage_url is not None
    assert "legacy.invalid" not in stage_url
    parsed = urlparse(stage_url)
    assert parsed.path.endswith("/api/v1/media/photos/private-stage-photo.jpg")
    query = parse_qs(parsed.query)
    assert query.get("expires")
    assert query.get("sig")
    assert validate_stage_photo_ticket(
        photo.storage_key,
        expires=int(query["expires"][0]),
        signature=query["sig"][0],
    )

    issue_url = issue_dict(issue)["photo_url"]
    assert issue_url == project_photo_media_url(issue.photo_key)
    parsed_issue = urlparse(issue_url)
    assert parsed_issue.path.endswith("/api/v1/media/photos/private-issue-photo.jpg")
    issue_query = parse_qs(parsed_issue.query)
    assert validate_stage_photo_ticket(
        issue.photo_key,
        expires=int(issue_query["expires"][0]),
        signature=issue_query["sig"][0],
    )


async def test_signed_stage_and_issue_photos_render_without_bearer_but_orphan_cannot(db, monkeypatch):
    _, _, _, _, _, photo, issue = await _fixture(db)

    monkeypatch.setattr(storage_service, "presigned_url", lambda _key: None)

    async def _read_image(key: str):
        if key == photo.storage_key:
            return b"stage-image"
        if key == issue.photo_key:
            return b"issue-image"
        return b"orphan"

    monkeypatch.setattr(storage_service, "read_image", _read_image)

    for key, expected in ((photo.storage_key, b"stage-image"), (issue.photo_key, b"issue-image")):
        expires, signature = issue_stage_photo_ticket(key)
        response = await get_media(
            key,
            authorization=None,
            x_user_id=None,
            expires=expires,
            sig=signature,
            db=db,
        )
        assert response.body == expected
        assert response.headers["cache-control"] == "private, max-age=300"

    orphan_key = "photos/orphan.jpg"
    orphan_expires, orphan_signature = issue_stage_photo_ticket(orphan_key)
    with pytest.raises(HTTPException) as exc_info:
        await get_media(
            orphan_key,
            authorization=None,
            x_user_id=None,
            expires=orphan_expires,
            sig=orphan_signature,
            db=db,
        )
    assert exc_info.value.status_code == 404
