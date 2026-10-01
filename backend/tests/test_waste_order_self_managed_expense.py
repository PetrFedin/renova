"""APIB-012 / EST-015 / EST-016: самоуправляемый проект, отмена, расход на done."""
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from app.models.entities import Expense, WasteOrderStatus
from app.services import outbox_inline_dispatch, waste_order_service
from tests.test_waste_order_lifecycle_integrity import seed_order, waste_db  # noqa: F401


@pytest.fixture(autouse=True)
def _no_inline_dispatch(monkeypatch):
    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", AsyncMock(return_value=0))


async def _step(db, project, order, actor, target):
    return await waste_order_service.transition_order(
        db, project=project, order_id=order.id, actor=actor, target=target
    )


@pytest.mark.asyncio
async def test_self_managed_customer_runs_full_cycle_and_expense_created_once(waste_db):
    customer, _, _, project, order = await seed_order(waste_db)
    project.contractor_id = None
    await waste_db.commit()

    for target in (WasteOrderStatus.requested, WasteOrderStatus.scheduled, WasteOrderStatus.done):
        result, replayed = await _step(waste_db, project, order, customer, target)
        assert result.status == target and replayed is False

    # повтор done не создаёт второй расход
    _, replayed = await _step(waste_db, project, order, customer, WasteOrderStatus.done)
    assert replayed is True
    rows = (await waste_db.execute(select(Expense).where(Expense.project_id == project.id))).scalars().all()
    assert len(rows) == 1
    assert rows[0].amount == 2.5 * 3500
    assert rows[0].status == "confirmed"
    await waste_db.refresh(project)
    assert project.budget_spent == 8750


@pytest.mark.asyncio
async def test_customer_cannot_request_when_contractor_assigned(waste_db):
    customer, _, _, project, order = await seed_order(waste_db)
    with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
        await _step(waste_db, project, order, customer, WasteOrderStatus.requested)


@pytest.mark.asyncio
async def test_cancel_from_draft_and_scheduled_by_customer(waste_db):
    customer, contractor, _, project, order = await seed_order(waste_db)
    result, _ = await _step(waste_db, project, order, customer, WasteOrderStatus.cancelled)
    assert result.status == WasteOrderStatus.cancelled

    # scheduled: отдельный заказ
    from app.models.entities import WasteOrder

    sched = WasteOrder(id="waste-sched", project_id=project.id, volume_m3=1, price=100,
                       status=WasteOrderStatus.scheduled)
    waste_db.add(sched)
    await waste_db.commit()
    result, _ = await _step(waste_db, project, sched, customer, WasteOrderStatus.cancelled)
    assert result.status == WasteOrderStatus.cancelled
    # отменённый не завершается и не создаёт расход
    with pytest.raises(ValueError, match="invalid_waste_order_transition"):
        await _step(waste_db, project, sched, contractor, WasteOrderStatus.done)
    assert await waste_db.scalar(select(func.count()).select_from(Expense)) == 0


@pytest.mark.asyncio
async def test_contractor_withdraws_draft_but_not_scheduled(waste_db):
    from app.models.entities import WasteOrder

    _, contractor, outsider, project, order = await seed_order(waste_db)
    with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
        await _step(waste_db, project, order, outsider, WasteOrderStatus.cancelled)
    sched = WasteOrder(id="waste-sched2", project_id=project.id, volume_m3=1, price=100,
                       status=WasteOrderStatus.scheduled)
    waste_db.add(sched)
    await waste_db.commit()
    with pytest.raises(ValueError, match="waste_order_actor_forbidden"):
        await _step(waste_db, project, sched, contractor, WasteOrderStatus.cancelled)
    result, _ = await _step(waste_db, project, order, contractor, WasteOrderStatus.cancelled)
    assert result.status == WasteOrderStatus.cancelled


@pytest.mark.asyncio
async def test_other_project_order_is_not_found(waste_db):
    customer, _, _, project, order = await seed_order(waste_db)
    from app.models.entities import Project

    other = Project(id="other-project", name="x", renovation_type="cosmetic", customer_id=customer.id)
    waste_db.add(other)
    await waste_db.commit()
    result, _ = await _step(waste_db, other, order, customer, WasteOrderStatus.cancelled)
    assert result is None
