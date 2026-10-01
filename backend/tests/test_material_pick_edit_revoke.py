"""EST-025 / EST-013 / EST-011: правка, удаление, отзыв согласования, количество подбора."""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.materials import (
    PickIn,
    PickPatchIn,
    RejectPickIn,
    create_pick,
    delete_pick,
    list_picks,
    patch_pick,
    revoke_pick,
)
from app.api.v1.selections import SelectionApproveIn, approve_selection
from app.models.entities import (
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    SelectionItem,
    SelectionStatus,
    User,
    UserRole,
)


async def _seed(db, suffix="a", contractor=True):
    customer = User(id=f"c-{suffix}", phone=f"+7999100{suffix:0>4}", role=UserRole.customer)
    ctr = User(id=f"x-{suffix}", phone=f"+7999200{suffix:0>4}", role=UserRole.contractor)
    db.add_all([customer, ctr])
    project = Project(
        id=f"p-{suffix}", name="P", renovation_type="cosmetic",
        customer_id=customer.id, contractor_id=ctr.id if contractor else None,
    )
    db.add(project)
    await db.commit()
    return customer, ctr, project


async def _pick(db, project, user, **kw):
    out = await create_pick(
        project.id,
        PickIn(name="Плитка", qty=2, unit="м2", price=100, client_request_id="req-12345678", **kw),
        user=user,
        db=db,
    )
    return out["id"]


@pytest.mark.asyncio
async def test_patch_updates_draft_and_is_idempotent(db):
    customer, _, project = await _seed(db)
    pid = await _pick(db, project, customer)
    out = await patch_pick(project.id, pid, PickPatchIn(qty=25, unit="м²", name="Плитка 60x60"), user=customer, db=db)
    assert out["qty"] == 25 and out["unit"] == "м²" and out["name"] == "Плитка 60x60"
    assert out["replayed"] is False
    again = await patch_pick(project.id, pid, PickPatchIn(qty=25, unit="м²", name="Плитка 60x60"), user=customer, db=db)
    assert again["replayed"] is True


@pytest.mark.asyncio
async def test_patch_pending_withdraws_to_draft_and_approved_is_locked(db):
    customer, ctr, project = await _seed(db)
    pid = await _pick(db, project, ctr)
    pick = await db.get(MaterialPick, pid)
    pick.status = MaterialPickStatus.pending
    await db.commit()
    out = await patch_pick(project.id, pid, PickPatchIn(qty=3), user=ctr, db=db)
    assert out["status"] == "draft"

    pick.status = MaterialPickStatus.approved
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await patch_pick(project.id, pid, PickPatchIn(qty=4), user=ctr, db=db)
    assert e.value.status_code == 409 and e.value.detail["code"] == "material_pick_not_editable"


@pytest.mark.asyncio
async def test_revoke_returns_approved_to_draft_customer_only_and_replays(db):
    customer, ctr, project = await _seed(db)
    pid = await _pick(db, project, ctr)
    pick = await db.get(MaterialPick, pid)
    pick.status = MaterialPickStatus.approved
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await revoke_pick(project.id, pid, RejectPickIn(), user=ctr, db=db)
    assert e.value.status_code == 403
    out = await revoke_pick(project.id, pid, RejectPickIn(reason="цена"), user=customer, db=db)
    assert out["status"] == "draft" and out["replayed"] is False
    out = await revoke_pick(project.id, pid, RejectPickIn(), user=customer, db=db)
    assert out["replayed"] is True


@pytest.mark.asyncio
async def test_revoke_blocked_by_active_purchase(db):
    customer, ctr, project = await _seed(db)
    pid = await _pick(db, project, ctr)
    pick = await db.get(MaterialPick, pid)
    pick.status = MaterialPickStatus.approved
    purchase = Purchase(id="pu-1", project_id=project.id, status=PurchaseStatus.draft)
    db.add(purchase)
    db.add(PurchaseItem(purchase_id="pu-1", material_pick_id=pid, name="x", qty=1, unit="шт", unit_price=1))
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await revoke_pick(project.id, pid, RejectPickIn(), user=customer, db=db)
    assert e.value.status_code == 409
    assert e.value.detail["code"] == "material_pick_locked_by_purchase"


@pytest.mark.asyncio
async def test_delete_draft_but_not_with_purchase_history(db):
    customer, ctr, project = await _seed(db)
    pid = await _pick(db, project, customer)
    out = await delete_pick(project.id, pid, user=customer, db=db)
    assert out["deleted"] is True
    assert await db.get(MaterialPick, pid) is None
    with pytest.raises(HTTPException) as e:
        await delete_pick(project.id, pid, user=customer, db=db)
    assert e.value.status_code == 404

    pick = MaterialPick(id="mp-h", project_id=project.id, name="h", qty=1, unit="шт", price=1)
    db.add(pick)
    db.add(Purchase(id="pu-h", project_id=project.id, status=PurchaseStatus.cancelled))
    db.add(PurchaseItem(purchase_id="pu-h", material_pick_id="mp-h", name="h", qty=1, unit="шт", unit_price=1))
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await delete_pick(project.id, "mp-h", user=customer, db=db)
    assert e.value.detail["code"] == "material_pick_has_purchase_history"


@pytest.mark.asyncio
async def test_cross_project_pick_is_404_for_patch_delete_revoke(db):
    customer, ctr, project_a = await _seed(db, "a")
    customer_b, _, project_b = await _seed(db, "b")
    pid = await _pick(db, project_a, customer)
    for call in (
        lambda: patch_pick(project_b.id, pid, PickPatchIn(qty=9), user=customer_b, db=db),
        lambda: delete_pick(project_b.id, pid, user=customer_b, db=db),
        lambda: revoke_pick(project_b.id, pid, RejectPickIn(), user=customer_b, db=db),
    ):
        with pytest.raises(HTTPException) as e:
            await call()
        assert e.value.status_code == 404
    assert (await db.get(MaterialPick, pid)).qty == 2


@pytest.mark.asyncio
async def test_list_exposes_price_actionable(db):
    customer, _, project = await _seed(db)
    await _pick(db, project, customer)
    rows = await list_picks(project.id, user=customer, db=db)
    assert "price_actionable" in rows[0] and "price_source" in rows[0]


@pytest.mark.asyncio
async def test_selection_approve_carries_qty_and_unit(db):
    customer, ctr, project = await _seed(db)
    row = SelectionItem(project_id=project.id, title="Плитка", category="tile", price=1000,
                        status=SelectionStatus.proposed, proposed_by_id=ctr.id)
    db.add(row)
    await db.commit()
    out = await approve_selection(project.id, row.id, SelectionApproveIn(qty=25.5, unit="м²"), user=customer, db=db)
    pick = await db.get(MaterialPick, out["material_pick_id"])
    assert pick.qty == 25.5 and pick.unit == "м²"
