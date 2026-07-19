"""W56: purchase paid/delivered → Expense(purchase_id) → budget fact."""
import pytest


@pytest.mark.asyncio
async def test_accept_stage_raises_use_orchestrator():
    from app.services import project_service as svc
    with pytest.raises(RuntimeError, match="use_orchestrator"):
        await svc.accept_stage(None, "x")  # type: ignore[arg-type]


def test_expense_from_purchase_helper_exists():
    from app.services import budget_service as bud
    assert hasattr(bud, "expense_from_purchase")
