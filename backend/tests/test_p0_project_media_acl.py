"""P0 #375: object binding and project-media privacy regressions."""
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from app.api.v1.estimate import LinePatch, patch_line
from app.api.v1.media import project_media_capability, upload_url
from app.models.entities import (
    ContractorPortfolioPhoto,
    ContractorProfile,
    EstimateLine,
    LineType,
    Project,
    Stage,
    StagePhoto,
    StageStatus,
    User,
    UserRole,
)
from app.services.project_media_acl import (
    assert_project_media_access,
    resolve_project_media_binding,
    verify_media_capability,
)


async def _fixture_graph(db):
    customer_a = User(id="customer-a", phone="+70000000001", role=UserRole.customer)
    customer_b = User(id="customer-b", phone="+70000000002", role=UserRole.customer)
    contractor = User(id="contractor-a", phone="+70000000003", role=UserRole.contractor)
    contractor_b = User(id="contractor-b", phone="+70000000004", role=UserRole.contractor)
    project_a = Project(
        id="project-a",
        name="A",
        renovation_type="cosmetic",
        customer_id=customer_a.id,
        contractor_id=contractor.id,
    )
    project_b = Project(
        id="project-b",
        name="B",
        renovation_type="cosmetic",
        customer_id=customer_b.id,
        contractor_id=contractor_b.id,
    )
    line_a = EstimateLine(
        id="line-a",
        project_id=project_a.id,
        line_type=LineType.material,
        name="Paint A",
        unit="pcs",
        quantity_planned=2,
        quantity_actual=0,
        unit_price=100,
    )
    line_b = EstimateLine(
        id="line-b",
        project_id=project_b.id,
        line_type=LineType.material,
        name="Paint B",
        unit="pcs",
        quantity_planned=3,
        quantity_actual=0,
        unit_price=200,
    )
    stage_a = Stage(
        id="stage-a",
        project_id=project_a.id,
        name="Stage A",
        sort_order=0,
        status=StageStatus.planned,
        percent_complete=0,
        payment_amount=0,
        weight_coefficient=0,
    )
    photo_a = StagePhoto(
        id="photo-a",
        stage_id=stage_a.id,
        user_id=contractor.id,
        caption="Before",
        storage_key="photos/private-a.jpg",
        image_url="http://test/api/v1/media/photos/private-a.jpg",
    )
    db.add_all([
        customer_a,
        customer_b,
        contractor,
        contractor_b,
        project_a,
        project_b,
        line_a,
        line_b,
        stage_a,
        photo_a,
    ])
    await db.commit()
    return customer_a, customer_b, contractor, project_a, project_b, line_a, line_b, stage_a, photo_a


@pytest.mark.asyncio
async def test_estimate_patch_cannot_mutate_line_from_unauthorized_project(db):
    _, _, contractor, project_a, _, _, line_b, _, _ = await _fixture_graph(db)

    with pytest.raises(HTTPException) as exc:
        await patch_line(
            project_id=project_a.id,
            line_id=line_b.id,
            body=LinePatch(quantity_planned=99),
            user=contractor,
            db=db,
        )

    assert exc.value.status_code == 404
    await db.refresh(line_b)
    assert line_b.quantity_planned == 3


@pytest.mark.asyncio
async def test_estimate_patch_still_updates_line_inside_authorized_project(db):
    _, _, contractor, project_a, _, line_a, _, _, _ = await _fixture_graph(db)

    result = await patch_line(
        project_id=project_a.id,
        line_id=line_a.id,
        body=LinePatch(quantity_planned=4),
        user=contractor,
        db=db,
    )

    assert result == {"ok": True, "id": line_a.id}
    await db.refresh(line_a)
    assert line_a.quantity_planned == 4


@pytest.mark.asyncio
async def test_legacy_stage_photo_resolves_to_project_and_foreign_user_gets_privacy_404(db):
    customer_a, customer_b, _, project_a, _, _, _, stage_a, photo_a = await _fixture_graph(db)

    binding = await resolve_project_media_binding(db, photo_a.storage_key)
    assert binding is not None
    assert binding.project_id == project_a.id
    assert binding.stage_id == stage_a.id

    allowed = await assert_project_media_access(db, customer_a, photo_a.storage_key)
    assert allowed.project_id == project_a.id

    with pytest.raises(HTTPException) as exc:
        await assert_project_media_access(db, customer_b, photo_a.storage_key)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_project_bound_upload_rejects_foreign_project_and_binds_stage_key(db):
    customer_a, customer_b, _, project_a, _, _, _, stage_a, _ = await _fixture_graph(db)

    issued = await upload_url(
        project_id=project_a.id,
        stage_id=stage_a.id,
        user=customer_a,
        db=db,
    )
    assert issued["key"].startswith(f"projects/{project_a.id}/stages/{stage_a.id}/photos/")

    with pytest.raises(HTTPException) as exc:
        await upload_url(
            project_id=project_a.id,
            stage_id=stage_a.id,
            user=customer_b,
            db=db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_media_capability_requires_current_project_access_and_is_short_lived(db):
    customer_a, customer_b, _, _, _, _, _, _, photo_a = await _fixture_graph(db)

    result = await project_media_capability(photo_a.storage_key, user=customer_a, db=db)
    parsed = urlparse(result["url"])
    query = parse_qs(parsed.query)
    expires_at = int(query["exp"][0])
    signature = query["sig"][0]
    assert verify_media_capability(
        photo_a.storage_key,
        expires_at=expires_at,
        signature=signature,
    ) is True

    with pytest.raises(HTTPException) as exc:
        await project_media_capability(photo_a.storage_key, user=customer_b, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_public_portfolio_reference_cannot_make_project_photo_public(db):
    customer_a, customer_b, contractor, _, _, _, _, _, photo_a = await _fixture_graph(db)
    profile = ContractorProfile(id="profile-a", user_id=contractor.id, visible=True)
    portfolio_photo = ContractorPortfolioPhoto(
        id="portfolio-photo-a",
        profile_id=profile.id,
        image_key=photo_a.storage_key,
        caption="Collision must remain private",
    )
    db.add_all([profile, portfolio_photo])
    await db.commit()

    # The owner can still mint a delivery capability.
    result = await project_media_capability(photo_a.storage_key, user=customer_a, db=db)
    assert "sig=" in result["url"]

    # Public classification must not override the authoritative project binding.
    with pytest.raises(HTTPException) as exc:
        await project_media_capability(photo_a.storage_key, user=customer_b, db=db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_unattached_opaque_media_key_is_not_an_authorization_boundary(db):
    customer_a, *_ = await _fixture_graph(db)
    with pytest.raises(HTTPException) as exc:
        await assert_project_media_access(db, customer_a, "photos/not-attached.jpg")
    assert exc.value.status_code == 404
