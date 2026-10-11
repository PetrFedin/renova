from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.entities import Project, User, UserRole
from app.models.project_documents import DocumentVersion, ProjectDocument
from app.services.integrations.export_archive import register_export_in_documents

pytestmark = pytest.mark.asyncio


async def test_export_registration_is_stable_and_versions_only_changed_bytes(db):
    user = User(phone="+79990009991", role=UserRole.customer, full_name="Export Owner")
    db.add(user)
    await db.flush()
    project = Project(
        name="Export artifact",
        renovation_type="cosmetic",
        property_type="apartment",
        customer_id=user.id,
    )
    db.add(project)
    await db.flush()

    href = f"/api/v1/projects/{project.id}/export/1c-payments.csv"
    first = await register_export_in_documents(
        db,
        project_id=project.id,
        user_id=user.id,
        title="Выгрузка 1С (CSV)",
        href=href,
        notes="payments+change_orders",
        checksum_sha256="a" * 64,
    )
    replay = await register_export_in_documents(
        db,
        project_id=project.id,
        user_id=user.id,
        title="Выгрузка 1С (CSV)",
        href=href,
        notes="payments+change_orders",
        checksum_sha256="a" * 64,
    )

    assert replay == first
    assert await db.scalar(
        select(func.count()).select_from(ProjectDocument).where(ProjectDocument.project_id == project.id)
    ) == 1
    assert await db.scalar(
        select(func.count()).select_from(DocumentVersion).where(DocumentVersion.document_id == first)
    ) == 1

    changed = await register_export_in_documents(
        db,
        project_id=project.id,
        user_id=user.id,
        title="Выгрузка 1С (CSV)",
        href=href,
        notes="payments+change_orders",
        checksum_sha256="b" * 64,
    )

    assert changed == first
    assert await db.scalar(
        select(func.count()).select_from(ProjectDocument).where(ProjectDocument.project_id == project.id)
    ) == 1
    versions = list(
        (
            await db.execute(
                select(DocumentVersion)
                .where(DocumentVersion.document_id == first)
                .order_by(DocumentVersion.version_number)
            )
        ).scalars().all()
    )
    assert [row.version_number for row in versions] == [1, 2]
    assert [row.checksum_sha256 for row in versions] == ["a" * 64, "b" * 64]
