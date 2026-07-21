"""W59: portal pay scope honesty + chat confirm_payment project bind."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import portal_token_service as portal_tok
from app.services import payment_service as pay_svc


@pytest.mark.asyncio
async def test_portal_token_pay_scope_sets_not_read_only(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.secret_key", "test-secret-key-w59-portal!!!!")
    token = portal_tok.create_portal_token(
        project_id="p1", user_id="u1", scopes=["read", "pay"]
    )
    claims = portal_tok.verify_portal_token(token)
    assert "pay" in claims["scopes"]
    assert claims["read_only"] is False


@pytest.mark.asyncio
async def test_confirm_payment_rejects_cross_project(db):
    from app.models.entities import Payment, PaymentStatus, PaymentType, Project, User, UserRole

    cust = User(id="c-w59", phone="+79990005901", role=UserRole.customer)
    pa = Project(id="pa-w59", name="A", renovation_type="cosmetic", customer_id=cust.id, budget_planned=1, budget_spent=0)
    pb = Project(id="pb-w59", name="B", renovation_type="cosmetic", customer_id=cust.id, budget_planned=1, budget_spent=0)
    pay = Payment(
        id="pay-w59",
        project_id=pb.id,
        payment_type=PaymentType.material,
        title="Cross",
        amount=100,
        status=PaymentStatus.pending,
        created_by=cust.id,
    )
    db.add_all([cust, pa, pb, pay])
    await db.commit()

    # Wrong project_id must not confirm
    out = await pay_svc.confirm_payment(db, pay.id, project_id=pa.id)
    assert out is None
    await db.refresh(pay)
    assert pay.status == PaymentStatus.pending

    out_ok = await pay_svc.confirm_payment(db, pay.id, project_id=pb.id, transfer_ack=True)
    assert out_ok is not None
    assert out_ok.status == PaymentStatus.paid_unverified
