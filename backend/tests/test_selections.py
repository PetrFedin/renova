"""P2.2: selections tracker flow."""
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.selections import SelectionIn, approve_selection, create_selection, propose_selection
from app.models.entities import (
    MaterialPick,
    Project,
    Room,
    SelectionItem,
    SelectionStatus,
    User,
    UserRole,
)
from sqlalchemy import func, select


def test_selection_in_rejects_negative_price():
    """Price/allowance are money — negative or absurd values must fail validation
    before they ever reach the DB (unbounded qty/price risk)."""
    with pytest.raises(ValidationError):
        SelectionIn(title="Тест", price=-999_999_999)


def test_selection_in_rejects_oversized_allowance():
    with pytest.raises(ValidationError):
        SelectionIn(title="Тест", price=100, allowance=999_999_999)


def test_selection_in_accepts_zero_price():
    row = SelectionIn(title="Тест", price=0)
    assert row.price == 0


@pytest.mark.asyncio
async def test_selection_propose_approve(db):
    customer = User(id="cust-sel", phone="+79993333331", role=UserRole.customer)
    contractor = User(id="contr-sel", phone="+79993333332", role=UserRole.contractor)
    db.add_all([customer, contractor])
    project = Project(
        id="proj-sel",
        name="Selections",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=200000,
        budget_spent=0,
    )
    db.add(project)
    await db.commit()

    row = SelectionItem(
        project_id=project.id,
        title="Плитка Kerama",
        category="tile",
        price=4500,
        allowance=4000,
        status=SelectionStatus.draft,
        proposed_by_id=contractor.id,
    )
    db.add(row)
    await db.commit()

    row.status = SelectionStatus.proposed
    await db.commit()

    row.status = SelectionStatus.approved
    from datetime import datetime
    row.approved_at = datetime.utcnow()
    await db.commit()
    await db.refresh(row)

    assert row.status == SelectionStatus.approved
    assert row.approved_at is not None
    assert row.price > (row.allowance or 0)


@pytest.mark.asyncio
async def test_approved_selection_creates_material_pick(db):
    from app.models.entities import MaterialPick
    from app.services.selection_service import material_pick_from_selection

    customer = User(id="cust-sel2", phone="+79994444441", role=UserRole.customer)
    db.add(customer)
    project = Project(
        id="proj-sel2",
        name="Pick link",
        renovation_type="cosmetic",
        customer_id=customer.id,
        budget_planned=100000,
        budget_spent=0,
    )
    db.add(project)
    await db.commit()

    row = SelectionItem(
        project_id=project.id,
        title="Смеситель Grohe",
        category="plumbing",
        price=12000,
        allowance=15000,
        status=SelectionStatus.approved,
    )
    db.add(row)
    await db.flush()

    pick = await material_pick_from_selection(db, row)
    await db.commit()

    assert pick.id
    assert pick.name == "Смеситель Grohe"
    assert pick.status.value == "approved"
    refreshed = await db.get(MaterialPick, pick.id)
    assert refreshed is not None


async def _seed_two_projects(db, suffix: str):
    """Shared contractor authorized for both Project A and Project B (issue #478 scenario)."""
    contractor = User(id=f"contr-{suffix}", phone=f"+7999555{suffix:0>4}", role=UserRole.contractor)
    customer = User(id=f"cust-{suffix}", phone=f"+7999666{suffix:0>4}", role=UserRole.customer)
    db.add_all([contractor, customer])
    project_a = Project(
        id=f"proj-a-{suffix}",
        name="Project A",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100000,
        budget_spent=0,
    )
    project_b = Project(
        id=f"proj-b-{suffix}",
        name="Project B",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
        budget_planned=100000,
        budget_spent=0,
    )
    room_b = Room(
        id=f"room-b-{suffix}",
        project_id=project_b.id,
        name="Кухня",
        length_m=4,
        width_m=3,
    )
    room_a = Room(
        id=f"room-a-{suffix}",
        project_id=project_a.id,
        name="Спальня",
        length_m=3,
        width_m=3,
    )
    db.add_all([project_a, project_b, room_a, room_b])
    await db.commit()
    return contractor, customer, project_a, project_b, room_a, room_b


@pytest.mark.asyncio
async def test_create_selection_rejects_cross_project_room(db):
    """Issue #478: Project A path + Room B body must 404 before any Selection,
    activity event, or side effect commits."""
    contractor, _customer, project_a, project_b, room_a, room_b = await _seed_two_projects(db, "1001")

    body = SelectionIn(title="Плитка", room_id=room_b.id, category="tile", price=1000)
    with pytest.raises(HTTPException) as excinfo:
        await create_selection(project_a.id, body, user=contractor, db=db)
    assert excinfo.value.status_code == 404

    count = (await db.execute(select(func.count()).select_from(SelectionItem))).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_create_selection_accepts_same_project_room_or_null(db):
    contractor, _customer, project_a, project_b, room_a, room_b = await _seed_two_projects(db, "1002")

    same_room = SelectionIn(title="Плитка", room_id=room_a.id, category="tile", price=1000)
    out = await create_selection(project_a.id, same_room, user=contractor, db=db)
    assert out["room_id"] == room_a.id
    assert out["project_id"] == project_a.id

    null_room = SelectionIn(title="Смеситель", room_id=None, category="plumbing", price=500)
    out2 = await create_selection(project_a.id, null_room, user=contractor, db=db)
    assert out2["room_id"] is None

    count = (await db.execute(select(func.count()).select_from(SelectionItem))).scalar_one()
    assert count == 2


@pytest.mark.asyncio
async def test_approve_cannot_create_material_pick_from_cross_project_selection(db):
    """Even if a Selection row already carries a foreign room_id (e.g. via a
    recovery/replay path that bypassed create-time validation), approve must
    refuse before the MaterialPick side effect runs."""
    contractor, customer, project_a, project_b, room_a, room_b = await _seed_two_projects(db, "1003")

    contaminated = SelectionItem(
        project_id=project_a.id,
        room_id=room_b.id,  # foreign room, bypassing create-time validation directly
        title="Contaminated selection",
        category="tile",
        price=1000,
        status=SelectionStatus.proposed,
        proposed_by_id=contractor.id,
    )
    db.add(contaminated)
    await db.commit()
    await db.refresh(contaminated)

    with pytest.raises(HTTPException) as excinfo:
        await approve_selection(project_a.id, contaminated.id, user=customer, db=db)
    assert excinfo.value.status_code == 404

    await db.refresh(contaminated)
    assert contaminated.status == SelectionStatus.proposed
    assert contaminated.approved_at is None

    pick_count = (await db.execute(select(func.count()).select_from(MaterialPick))).scalar_one()
    assert pick_count == 0


@pytest.mark.asyncio
async def test_approve_succeeds_for_same_project_room(db):
    contractor, customer, project_a, project_b, room_a, room_b = await _seed_two_projects(db, "1004")

    row = SelectionItem(
        project_id=project_a.id,
        room_id=room_a.id,
        title="Плитка Kerama",
        category="tile",
        price=1000,
        status=SelectionStatus.proposed,
        proposed_by_id=contractor.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    out = await approve_selection(project_a.id, row.id, user=customer, db=db)
    assert out["status"] == "approved"
    assert out["material_pick_id"]

    pick_count = (await db.execute(select(func.count()).select_from(MaterialPick))).scalar_one()
    assert pick_count == 1
