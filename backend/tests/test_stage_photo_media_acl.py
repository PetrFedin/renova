"""P0: stage photo bytes must never escape the owning project ACL."""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from app.api.v1.media import get_media
from app.models.entities import Project, Stage, StagePhoto, User, UserRole
from app.services import storage_service
from app.services.stage_photo_media_acl import (
    assert_stage_photo_media_access,
    issue_stage_photo_ticket,
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
    db.add(photo)
    await db.commit()
    await db.refresh(photo)
    return customer, contractor, outsider, project, stage, photo


async def test_stage_photo_media_acl_allows_project_members_and_hides_from_outsider(db):
    customer, contractor, outsider, project, _, photo = await _fixture(db)

    assert await assert_stage_photo_media_access(db, customer, photo.storage_key) == project.id
    assert await assert_stage_photo_media_access(db, contractor, photo.storage_key) == project.id

    with pytest.raises(HTTPException) as exc_info:
        await assert_stage_photo_media_access(db, outsider, photo.storage_key)
    assert exc_info.value.status_code == 404


async def test_stage_photo_ticket_is_short_lived_and_bound_to_exact_storage_key(db):
    _, _, _, _, _, photo = await _fixture(db)
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


async def test_stage_read_model_replaces_legacy_public_url_with_signed_media_url(db):
    _, _, _, _, _, photo = await _fixture(db)

    signed_url = stage_photo_media_url(photo)
    assert signed_url is not None
    assert "legacy.invalid" not in signed_url
    parsed = urlparse(signed_url)
    assert parsed.path.endswith("/api/v1/media/photos/private-stage-photo.jpg")
    query = parse_qs(parsed.query)
    assert query.get("expires")
    assert query.get("sig")
    assert validate_stage_photo_ticket(
        photo.storage_key,
        expires=int(query["expires"][0]),
        signature=query["sig"][0],
    )


async def test_signed_stage_photo_can_render_without_bearer_but_orphan_cannot(db, monkeypatch):
    _, _, _, _, _, photo = await _fixture(db)

    monkeypatch.setattr(storage_service, "presigned_url", lambda _key: None)

    async def _read_image(key: str):
        return b"private-image" if key == photo.storage_key else b"orphan"

    monkeypatch.setattr(storage_service, "read_image", _read_image)

    expires, signature = issue_stage_photo_ticket(photo.storage_key)
    response = await get_media(
        photo.storage_key,
        authorization=None,
        x_user_id=None,
        expires=expires,
        sig=signature,
        db=db,
    )
    assert response.body == b"private-image"
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
