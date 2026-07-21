"""transfer_ack alone → paid_unverified; receipt/webhook → confirmed + budget."""
import pytest
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    Payment, PaymentStatus, PaymentType, Project, Stage, User, UserRole, Receipt,
)
from app.services import payment_service as pay_svc


@pytest.mark.asyncio
async def test_transfer_ack_without_receipt_is_unverified(db: AsyncSession):
    cust = User(phone="+70000000001", role=UserRole.customer, full_name="C")
    db.add(cust)
    await db.flush()
    project = Project(
        name="P", renovation_type="capital", customer_id=cust.id, budget_planned=100000, budget_spent=0, progress_percent=50,
    )
    db.add(project)
    await db.flush()
    stage = Stage(project_id=project.id, name="S", status="done", customer_accepted_at=datetime.utcnow())
    db.add(stage)
    await db.flush()
    pay = Payment(
        project_id=project.id,
        stage_id=stage.id,
        payment_type=PaymentType.stage,
        status=PaymentStatus.pending,
        title="Invoice",
        amount=1000,
        created_by=cust.id,
    )
    db.add(pay)
    await db.commit()

    out = await pay_svc.confirm_payment(db, pay.id, project_id=project.id, transfer_ack=True)
    assert out is not None
    assert out.status == PaymentStatus.paid_unverified
    await db.refresh(project)
    assert project.budget_spent == 0

    # attach receipt then confirm → budget
    rec = Receipt(project_id=project.id, amount=1000, payment_id=pay.id, fns_verified=False)
    db.add(rec)
    await db.commit()
    out2 = await pay_svc.confirm_payment(db, pay.id, project_id=project.id, transfer_ack=True)
    assert out2 is not None
    assert out2.status == PaymentStatus.confirmed
    await db.refresh(project)
    assert project.budget_spent == 1000
