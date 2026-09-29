"""Снятый с учёта расход виден по явному запросу — иначе его не вернуть."""
import pytest

from app.models.entities import Expense, Project, User, UserRole
from app.services import budget_service_legacy as bud

pytestmark = pytest.mark.asyncio


async def _seed(db) -> str:
    customer = User(id="cust-del", phone="+70000004101", role=UserRole.customer)
    project = Project(
        id="proj-del",
        name="Список снятого",
        renovation_type="cosmetic",
        customer_id=customer.id,
        budget_planned=100000,
        budget_spent=0,
    )
    alive = Expense(
        id="exp-alive",
        project_id=project.id,
        title="Живой расход",
        amount=1000,
        category="materials",
        status="confirmed",
    )
    removed = Expense(
        id="exp-removed",
        project_id=project.id,
        title="Снятый расход",
        amount=2000,
        category="materials",
        status="deleted",
    )
    db.add_all([customer, project, alive, removed])
    await db.commit()
    return project.id


async def test_default_list_hides_removed_expenses(db):
    project_id = await _seed(db)
    ids = {item.id for item in await bud.list_expenses(db, project_id)}
    assert ids == {"exp-alive"}


async def test_explicit_deleted_status_returns_removed_expenses(db):
    """Без этого кнопка «Вернуть» просто некуда было бы поставить."""
    project_id = await _seed(db)
    ids = {item.id for item in await bud.list_expenses(db, project_id, status="deleted")}
    assert ids == {"exp-removed"}


async def test_confirmed_status_still_excludes_removed(db):
    project_id = await _seed(db)
    ids = {item.id for item in await bud.list_expenses(db, project_id, status="confirmed")}
    assert ids == {"exp-alive"}
