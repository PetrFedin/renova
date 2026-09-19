"""Приложение на доп. работы — не договор подряда.

Документ доп. работ создаётся с ``document_type = contract``, поэтому:

* гейт договора считал его подписанным договором и снимал блокировку работ —
  заказчик, подписавший приложение на 12 000 ₽, юридически не подписывал
  договор на всю смету, но «нельзя начинать без договора» переставало
  действовать;
* ``ensure_contract_draft`` находил его и не создавал «Договор подряда»
  вовсе — в Документах объекта договора не появлялось никогда.

Отдельного типа для доп. работ в перечислении нет, но у документа есть
``change_order_id`` — этого достаточно, чтобы отличить одно от другого без
миграции перечисления.
"""
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.entities import ChangeOrder, ChangeOrderStatus, Project, User, UserRole
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


async def add_signed_change_order_document(db, project: Project) -> ProjectDocument:
    """Подписанное заказчиком приложение на доп. работы."""
    order = ChangeOrder(
        id=f"co-{project.id}",
        project_id=project.id,
        title="Дополнительные розетки",
        amount=12000,
        status=ChangeOrderStatus.approved,
        created_by=project.contractor_id,
    )
    db.add(order)
    await db.flush()
    document = ProjectDocument(
        project_id=project.id,
        title="Доп. работы: Дополнительные розетки",
        document_type=DocumentType.contract.value,
        status=DocumentStatus.draft.value,
        change_order_id=order.id,
        created_by=project.contractor_id,
    )
    db.add(document)
    await db.flush()
    version = DocumentVersion(
        document_id=document.id,
        version_number=1,
        storage_key=f"docs/{document.id}-1.pdf",
        created_by=project.contractor_id,
    )
    db.add(version)
    await db.flush()
    db.add(
        DocumentSignature(
            document_id=document.id,
            version_id=version.id,
            signer_user_id=project.customer_id,
            signer_role="customer",
            status="signed",
            signed_at=utc_now(),
        )
    )
    await db.commit()
    return document


@pytest.mark.asyncio
async def test_a_signed_addendum_does_not_open_the_work(db):
    """Проверка идёт через сам старт этапа, а не через поле гейта.

    `gate["ok"]` здесь ответил бы `True`: договоров на объекте не осталось,
    и гейт честно говорит `no_contract_required`. Работы при этом всё равно
    не начинаются — их держит правило старта этапа. Утверждение «работы не
    открылись» должно проверяться там, где они открываются.
    """
    from app.models.entities import Stage, StageStatus
    from app.services import stage_mutation_service as mutations

    project = await seed(db, suffix="0001")
    addendum = await add_signed_change_order_document(db, project)
    # start_stage при отказе откатывает транзакцию, и загруженные объекты
    # истекают: идентификаторы нужны до вызова, иначе обращение к ним падает.
    project_id = project.id
    addendum_id = addendum.id
    contractor_id = project.contractor_id
    stage = Stage(
        id="s-0001",
        project_id=project.id,
        name="Демонтаж",
        sort_order=0,
        status=StageStatus.planned,
        payment_amount=1000,
        weight_coefficient=1.0,
    )
    db.add(stage)
    await db.commit()

    contractor = await db.get(User, contractor_id)
    started, error = await mutations.start_stage(
        db, project_id=project_id, stage_id=stage.id, actor=contractor
    )

    assert started is None and error is not None, (
        "подпись приложения на доп. работы открыла работы по всему объекту"
    )
    assert error["code"] == "contract_not_signed"

    gate = await docs.project_contract_gate(db, project_id)
    assert gate.get("document_id") != addendum_id, (
        "приложение на доп. работы принято за договор подряда"
    )


@pytest.mark.asyncio
async def test_the_main_contract_is_still_created(db):
    """Приложение не должно занимать место договора подряда."""
    project = await seed(db, suffix="0002")
    await add_signed_change_order_document(db, project)

    result = await docs.ensure_contract_draft(
        db, project_id=project.id, created_by=project.customer_id
    )
    await db.commit()

    assert result["created"] is True, (
        "договор подряда не создан: его место занял документ доп. работ"
    )
    assert result["pending_titles"] == ["Договор подряда"]

    contracts = list(
        (
            await db.execute(
                select(ProjectDocument).where(
                    ProjectDocument.project_id == project.id,
                    ProjectDocument.change_order_id.is_(None),
                )
            )
        ).scalars().all()
    )
    assert [c.title for c in contracts] == ["Договор подряда"]


@pytest.mark.asyncio
async def test_the_signed_main_contract_still_opens_the_work(db):
    """Правка не должна ломать нормальный путь."""
    project = await seed(db, suffix="0003")
    await add_signed_change_order_document(db, project)

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
    await db.flush()
    db.add(
        DocumentSignature(
            document_id=document.id,
            version_id=version.id,
            signer_user_id=project.customer_id,
            signer_role="customer",
            status="signed",
            signed_at=utc_now(),
        )
    )
    await db.commit()

    gate = await docs.project_contract_gate(db, project.id)

    assert gate["ok"] is True
    assert gate["document_id"] == document.id


@pytest.mark.asyncio
async def test_the_refusal_names_the_contract_not_the_addendum(db):
    """В списке «что подписать» не должно быть приложений на доп. работы."""
    project = await seed(db, suffix="0004")
    await add_signed_change_order_document(db, project)
    await docs.ensure_contract_draft(
        db, project_id=project.id, created_by=project.customer_id
    )
    await db.commit()

    gate = await docs.project_contract_gate(db, project.id)

    assert gate["pending_titles"] == ["Договор подряда"], (
        f"в список подписания попало приложение: {gate['pending_titles']}"
    )
