"""Гейт договора защищает заказчика и не запирает исполнителя.

Две беды в одном месте:

1. Каноническая проверка старта этапа блокировала объект, у которого договора
   нет вовсе: ``no_contract_required`` — это «можно», а условие трактовало его
   как «нельзя». Подписывать нечего, ``pending_titles`` пуст, нажать нечего.
   Легаси-путь в ``stage_service`` проверял то же самое иначе — пути
   противоречили друг другу.

2. Гейт засчитывал ЛЮБУЮ одну подпись любой роли. Исполнитель подписывал
   договор в одиночку и сам себе открывал работы — согласия заказчика,
   ради которого гейт и существует, не требовалось.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import Project, User, UserRole
import app.models.outbox_runtime  # noqa: F401
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    ProjectDocument,
)
import app.models.work_schedule  # noqa: F401
from app.services import project_document_service as docs


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def seed(db, *, suffix: str) -> Project:
    customer = User(id=f"c-{suffix}", phone=f"+7999{suffix:0>7}", role=UserRole.customer)
    contractor = User(id=f"k-{suffix}", phone=f"+7888{suffix:0>7}", role=UserRole.contractor)
    project = Project(
        id=f"p-{suffix}",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return project


async def add_contract(db, project: Project) -> tuple[ProjectDocument, DocumentVersion]:
    document = ProjectDocument(
        project_id=project.id,
        title="Договор подряда",
        document_type=DocumentType.contract.value,
        status=DocumentStatus.draft.value,
        created_by=project.customer_id,
    )
    db.add(document)
    await db.flush()
    version = DocumentVersion(
        document_id=document.id,
        version_number=1,
        storage_key=f"docs/{document.id}-1.pdf",
        created_by=project.customer_id,
    )
    db.add(version)
    await db.commit()
    return document, version


async def sign(db, document, version, *, user_id: str, role: str) -> None:
    db.add(
        DocumentSignature(
            document_id=document.id,
            version_id=version.id,
            signer_user_id=user_id,
            signer_role=role,
            status="signed",
            signed_at=utc_now(),
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_a_contractor_cannot_open_the_work_alone(db):
    """Подпись исполнителя — не согласие заказчика."""
    project = await seed(db, suffix="0001")
    document, version = await add_contract(db, project)
    await sign(db, document, version, user_id=project.contractor_id, role="contractor")

    gate = await docs.project_contract_gate(db, project.id)

    assert gate["ok"] is False, (
        "исполнитель подписал договор в одиночку и открыл себе работы"
    )
    assert gate["code"] == "contract_not_signed"
    assert gate["pending_titles"] == ["Договор подряда"], (
        "пользователю нужно сказать, что именно подписывать"
    )


@pytest.mark.asyncio
async def test_the_customer_signature_opens_the_work(db):
    project = await seed(db, suffix="0002")
    document, version = await add_contract(db, project)
    await sign(db, document, version, user_id=project.customer_id, role="customer")

    gate = await docs.project_contract_gate(db, project.id)

    assert gate["ok"] is True
    assert gate["document_id"] == document.id


@pytest.mark.asyncio
async def test_both_signatures_are_fine(db):
    project = await seed(db, suffix="0003")
    document, version = await add_contract(db, project)
    await sign(db, document, version, user_id=project.contractor_id, role="contractor")
    await sign(db, document, version, user_id=project.customer_id, role="customer")

    gate = await docs.project_contract_gate(db, project.id)

    assert gate["ok"] is True


@pytest.mark.asyncio
async def test_no_contract_is_not_a_dead_end(db):
    """Договора нет — значит подписывать нечего, и запирать не за что."""
    project = await seed(db, suffix="0004")

    gate = await docs.project_contract_gate(db, project.id)

    assert gate["ok"] is True
    assert gate["reason"] == "no_contract_required"


@pytest.mark.asyncio
async def test_assignment_creates_something_to_sign(db):
    """Появился исполнитель — появился и договор.

    Правило «объект с исполнителем не начинает работы без подписанного
    договора» намеренное и закреплено отдельным тестом. Тупик возникал не
    из-за правила, а из-за того, что договор создавался только при фиксации
    сметы: у объекта из заявки его не было никогда, и отказ приходил с
    пустым списком того, что нужно подписать.
    """
    from app.services import project_assignment_service as assignment

    project = await seed(db, suffix="0005")
    project.contractor_id = None
    await db.commit()

    result = await assignment.assign_contractor(
        db,
        project_id=project.id,
        contractor_id=f"k-0005",
        actor_id=project.customer_id,
    )
    assert result.status == "assigned", result.status

    gate = await docs.project_contract_gate(db, project.id)
    assert gate["ok"] is False, "договор ещё не подписан — работы открывать рано"
    assert gate["pending_titles"], (
        "отказ без списка документов — тупик: пользователю нечего открыть"
    )
    assert "Договор подряда" in gate["pending_titles"]
