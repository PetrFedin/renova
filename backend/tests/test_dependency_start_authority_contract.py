from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest

from app.models.entities import (
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Stage,
    StageStatus,
    User,
    UserRole,
    WorkDependency,
)
from app.models.project_documents import (
    DocumentSignature,
    DocumentStatus,
    DocumentType,
    DocumentVersion,
    ProjectDocument,
)
from app.services import purchase_service, stage_mutation_service


ROOT = Path(__file__).resolve().parents[1]


def _id() -> str:
    return str(uuid4())


def _user(role: UserRole) -> User:
    return User(
        id=_id(),
        phone=f"+7{uuid4().int % 10_000_000_000:010d}",
        role=role,
    )


async def _project_with_material_purchase(
    db,
    *,
    stage_status: StageStatus,
    pick_status: MaterialPickStatus,
    dependency_status: str,
    purchase_status: PurchaseStatus,
    qty_delivered: float,
    actual_start: date | None = None,
):
    customer = _user(UserRole.customer)
    project = Project(
        id=_id(),
        name="Execution integrity project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    stage = Stage(
        id=_id(),
        project_id=project.id,
        name="Монтаж",
        sort_order=0,
        status=stage_status,
        actual_start=actual_start,
    )
    pick = MaterialPick(
        id=_id(),
        project_id=project.id,
        stage_id=stage.id,
        name="Плитка",
        qty=3,
        qty_needed=3,
        qty_delivered=qty_delivered,
        unit="шт",
        price=100,
        status=pick_status,
    )
    dependency = WorkDependency(
        id=_id(),
        project_id=project.id,
        stage_id=stage.id,
        depends_on_material_pick_id=pick.id,
        dependency_type="material",
        criticality="high",
        status=dependency_status,
    )
    purchase = Purchase(
        id=_id(),
        project_id=project.id,
        status=purchase_status,
        total_amount=300,
        items=[
            PurchaseItem(
                id=_id(),
                material_pick_id=pick.id,
                name=pick.name,
                qty=3,
                unit=pick.unit,
                unit_price=pick.price,
                stage_id=stage.id,
            )
        ],
    )
    db.add_all([customer, project, stage, pick, dependency, purchase])
    await db.commit()
    return customer, stage, pick, dependency, purchase


async def _contractor_project_stage(db, *, signed_contract: bool = False):
    customer = _user(UserRole.customer)
    contractor = _user(UserRole.contractor)
    other_contractor = _user(UserRole.contractor)
    project = Project(
        id=_id(),
        name="Contractor execution project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    stage = Stage(
        id=_id(),
        project_id=project.id,
        name="Подрядный этап",
        sort_order=0,
        status=StageStatus.planned,
        assignee_id=contractor.id,
    )
    rows = [customer, contractor, other_contractor, project, stage]
    if signed_contract:
        document_id = _id()
        version_id = _id()
        contract = ProjectDocument(
            id=document_id,
            project_id=project.id,
            document_type=DocumentType.contract.value,
            title="Договор подряда",
            status=DocumentStatus.active.value,
            current_version_id=version_id,
            created_by=customer.id,
        )
        version = DocumentVersion(
            id=version_id,
            document_id=document_id,
            version_number=1,
            created_by=customer.id,
        )
        signature = DocumentSignature(
            id=_id(),
            document_id=document_id,
            version_id=version_id,
            signer_user_id=customer.id,
            signer_role="customer",
            status="signed",
        )
        rows.extend([contract, version, signature])
    db.add_all(rows)
    await db.commit()
    return project, stage, contractor, other_contractor


def test_material_delivery_does_not_manufacture_execution_truth():
    source = (ROOT / "app/services/dependency_service.py").read_text(encoding="utf-8")
    material_handler = source.split("async def on_material_delivered", 1)[1]

    assert 'dependency.status = "satisfied"' in material_handler
    assert 'evaluation["blocked"]' in material_handler
    assert "stage.status = StageStatus.active" not in material_handler
    assert "stage.actual_start =" not in material_handler


def test_purchase_logistics_do_not_mutate_stage_execution_lifecycle():
    source = (ROOT / "app/services/purchase_service.py").read_text(encoding="utf-8")
    reversed_handler = source.split("async def _on_reversed", 1)[1].split(
        "async def _on_delivered", 1
    )[0]
    delivered_handler = source.split("async def _on_delivered", 1)[1].split(
        "async def generate_needs_from_estimate", 1
    )[0]

    assert "stage.status =" not in reversed_handler
    assert "stage.actual_start =" not in reversed_handler
    assert "stage.status =" not in delivered_handler
    assert "stage.actual_start =" not in delivered_handler


async def test_purchase_delivery_unlocks_dependency_without_starting_stage(db):
    _, stage, pick, dependency, purchase = await _project_with_material_purchase(
        db,
        stage_status=StageStatus.planned,
        pick_status=MaterialPickStatus.approved,
        dependency_status="pending",
        purchase_status=PurchaseStatus.paid,
        qty_delivered=0,
    )

    await purchase_service._on_delivered(db, purchase)
    await db.flush()

    assert pick.status == MaterialPickStatus.purchased
    assert pick.qty_delivered == 3
    assert dependency.status == "satisfied"
    assert stage.status == StageStatus.planned
    assert stage.actual_start is None


async def test_self_managed_stage_starts_explicitly_only_after_delivery_unblocks_it(db):
    customer, stage, pick, dependency, purchase = await _project_with_material_purchase(
        db,
        stage_status=StageStatus.planned,
        pick_status=MaterialPickStatus.approved,
        dependency_status="pending",
        purchase_status=PurchaseStatus.paid,
        qty_delivered=0,
    )

    await purchase_service._on_delivered(db, purchase)
    assert stage.status == StageStatus.planned
    assert stage.actual_start is None

    result, error = await stage_mutation_service.start_stage(
        db,
        project_id=stage.project_id,
        stage_id=stage.id,
        actor=customer,
    )

    assert error is None
    assert result is not None
    assert result.stage.status == StageStatus.active
    assert result.stage.actual_start is not None
    assert pick.status == MaterialPickStatus.purchased
    assert dependency.status == "satisfied"


async def test_purchase_return_reblocks_dependency_without_rewinding_active_stage(db):
    started_on = date(2026, 9, 1)
    _, stage, pick, dependency, purchase = await _project_with_material_purchase(
        db,
        stage_status=StageStatus.active,
        pick_status=MaterialPickStatus.purchased,
        dependency_status="satisfied",
        purchase_status=PurchaseStatus.delivered,
        qty_delivered=3,
        actual_start=started_on,
    )

    await purchase_service._on_reversed(db, purchase, was_delivered=True)
    await db.flush()

    assert pick.status == MaterialPickStatus.approved
    assert pick.qty_delivered == 0
    assert dependency.status == "pending"
    assert stage.status == StageStatus.active
    assert stage.actual_start == started_on


async def test_differently_assigned_contractor_cannot_start_stage(db):
    project, stage, _, other_contractor = await _contractor_project_stage(db)

    with pytest.raises(ValueError, match="stage_execution_actor_forbidden"):
        await stage_mutation_service.start_stage(
            db,
            project_id=project.id,
            stage_id=stage.id,
            actor=other_contractor,
        )

    await db.refresh(stage)
    assert stage.status == StageStatus.planned
    assert stage.actual_start is None


async def test_contractor_project_without_contract_cannot_start_stage(db):
    project, stage, contractor, _ = await _contractor_project_stage(db)

    result, error = await stage_mutation_service.start_stage(
        db,
        project_id=project.id,
        stage_id=stage.id,
        actor=contractor,
    )

    assert result is None
    assert error is not None
    assert error["code"] == "contract_not_signed"
    await db.refresh(stage)
    assert stage.status == StageStatus.planned
    assert stage.actual_start is None


async def test_signed_contractor_can_use_canonical_start(db):
    project, stage, contractor, _ = await _contractor_project_stage(db, signed_contract=True)

    result, error = await stage_mutation_service.start_stage(
        db,
        project_id=project.id,
        stage_id=stage.id,
        actor=contractor,
    )

    assert error is None
    assert result is not None
    assert result.stage.status == StageStatus.active
    assert result.stage.actual_start is not None


def test_canonical_start_retains_authority_contract():
    source = (ROOT / "app/services/stage_mutation_service.py").read_text(encoding="utf-8")

    assert "_require_execution_actor(project, stage, actor)" in source
    assert "project_contract_gate(db, project.id)" in source
    assert 'gate.get("reason") == "no_contract_required"' in source
    assert "dependency_service.evaluate_stage" in source
    assert "stage.status = StageStatus.active" in source
    assert "stage.actual_start" in source
