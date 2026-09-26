from __future__ import annotations

from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from starlette.datastructures import Headers

from app.api.v1 import documents as api
from app.models.entities import Payment, PaymentType, Project, Stage, User, UserRole
from app.models.project_documents import ProjectDocument
from app.schemas.project_documents import DocumentCreateIn


async def _seed_two_projects(db):
    customer = User(id="doc-ref-user", phone="+79990004720", role=UserRole.customer)
    db.add(customer)
    await db.flush()

    project_a = Project(
        id="doc-ref-project-a",
        name="A",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    project_b = Project(
        id="doc-ref-project-b",
        name="B",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add_all([project_a, project_b])
    await db.flush()

    stage_a = Stage(id="doc-ref-stage-a", project_id=project_a.id, name="Stage A")
    stage_b = Stage(id="doc-ref-stage-b", project_id=project_b.id, name="Stage B")
    db.add_all([stage_a, stage_b])
    await db.flush()

    payment_a = Payment(
        id="doc-ref-payment-a",
        project_id=project_a.id,
        stage_id=stage_a.id,
        payment_type=PaymentType.stage,
        title="Payment A",
        amount=1000,
        created_by=customer.id,
    )
    payment_b = Payment(
        id="doc-ref-payment-b",
        project_id=project_b.id,
        stage_id=stage_b.id,
        payment_type=PaymentType.stage,
        title="Payment B",
        amount=2000,
        created_by=customer.id,
    )
    db.add_all([payment_a, payment_b])
    await db.commit()
    return customer, project_a, project_b, stage_a, stage_b, payment_a, payment_b


@pytest.mark.asyncio
async def test_document_create_rejects_foreign_stage_and_payment(db):
    customer, project_a, _, stage_a, stage_b, payment_a, payment_b = await _seed_two_projects(db)

    with pytest.raises(HTTPException) as foreign_stage:
        await api.create_project_document(
            project_a.id,
            DocumentCreateIn(title="Foreign stage", stage_id=stage_b.id),
            user=customer,
            db=db,
        )
    assert foreign_stage.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_payment:
        await api.create_project_document(
            project_a.id,
            DocumentCreateIn(title="Foreign payment", payment_id=payment_b.id),
            user=customer,
            db=db,
        )
    assert foreign_payment.value.status_code == 404

    leaked = list(
        (
            await db.execute(
                select(ProjectDocument).where(
                    ProjectDocument.project_id == project_a.id,
                    ProjectDocument.title.in_(["Foreign stage", "Foreign payment"]),
                )
            )
        ).scalars().all()
    )
    assert leaked == []

    own = await api.create_project_document(
        project_a.id,
        DocumentCreateIn(
            title="Own refs",
            stage_id=stage_a.id,
            payment_id=payment_a.id,
        ),
        user=customer,
        db=db,
    )
    assert own["meta"]["project_id"] == project_a.id
    assert own["meta"]["stage_id"] == stage_a.id
    assert own["meta"]["payment_id"] == payment_a.id


@pytest.mark.asyncio
async def test_document_upload_rejects_foreign_reference_before_storage(db, monkeypatch):
    customer, project_a, _, _, stage_b, _, _ = await _seed_two_projects(db)
    storage_called = False

    async def forbidden_save(*_args, **_kwargs):
        nonlocal storage_called
        storage_called = True
        raise AssertionError("storage must not run for a foreign document reference")

    monkeypatch.setattr(api.storage_svc, "save_bytes", forbidden_save)
    upload = UploadFile(
        file=BytesIO(b"%PDF-1.4 bounded security test"),
        filename="foreign.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )

    with pytest.raises(HTTPException) as foreign_stage:
        await api.upload_project_document(
            project_a.id,
            file=upload,
            title="Foreign upload",
            document_type="upload",
            stage_id=stage_b.id,
            payment_id=None,
            notes=None,
            user=customer,
            db=db,
        )
    assert foreign_stage.value.status_code == 404
    assert storage_called is False
