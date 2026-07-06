from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import change_order_service as co_svc

router = APIRouter(prefix="/projects/{project_id}/change-orders", tags=["change-orders"])


class ChangeOrderCreate(BaseModel):
    title: str
    amount: float = Field(gt=0)
    description: str | None = None


@router.get("")
async def list_co(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await co_svc.list_orders(db, project_id)
    return [{"id": x.id, "title": x.title, "amount": x.amount, "status": x.status.value, "description": x.description} for x in items]


@router.post("")
async def create_co(project_id: str, body: ChangeOrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    co = await co_svc.create_order(db, project_id, user.id, body.title, body.amount, body.description)
    return {"id": co.id, "status": co.status.value}


@router.post("/{order_id}/approve")
async def approve_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.customer:
        raise HTTPException(403)
    co = await co_svc.approve(db, order_id)
    if not co:
        raise HTTPException(404)
    return {"ok": True, "status": co.status.value}


@router.post("/{order_id}/reject")
async def reject_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.customer:
        raise HTTPException(403)
    co = await co_svc.reject(db, order_id)
    if not co:
        raise HTTPException(404)
    return {"ok": True, "status": co.status.value}
