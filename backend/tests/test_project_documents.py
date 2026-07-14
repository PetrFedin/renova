"""Canonical ProjectDocument service smoke (D-01)."""
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
import app.models.entities  # noqa: F401
import app.models.work_schedule  # noqa: F401
import app.models.project_documents  # noqa: F401
from app.models.project_documents import DocumentType
from app.services.project_document_service import (
    create_document,
    ensure_acceptance_act_document,
    list_canonical_documents,
    sign_document,
)


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_list_sign_document(db):
    doc = await create_document(
        db,
        project_id="p1",
        created_by="u1",
        title="Договор подряда",
        document_type=DocumentType.contract.value,
        href="/files/contract.pdf",
    )
    await db.commit()

    items = await list_canonical_documents(db, "p1")
    assert len(items) == 1
    assert items[0]["title"] == "Договор подряда"
    assert items[0]["source"] == "canonical"
    assert items[0]["version"] == 1

    await sign_document(db, doc, signer_user_id="u1", signer_role="customer")
    await db.commit()
    items = await list_canonical_documents(db, "p1")
    assert len(items[0]["meta"]["signatures"]) == 1


@pytest.mark.asyncio
async def test_ensure_acceptance_idempotent(db):
    a = await ensure_acceptance_act_document(
        db,
        project_id="p1",
        stage_id="s1",
        stage_name="Демонтаж",
        acceptance_id="wa1",
        accepted_by="u1",
    )
    b = await ensure_acceptance_act_document(
        db,
        project_id="p1",
        stage_id="s1",
        stage_name="Демонтаж",
        acceptance_id="wa1",
        accepted_by="u1",
    )
    await db.commit()
    assert a.id == b.id
