from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import change_order_service as co_svc
from app.services import activity_service as act
from app.services import notification_service as notif

router = APIRouter(prefix="/projects/{project_id}/change-orders", tags=["change-orders"])


class ChangeOrderCreate(BaseModel):
    title: str
    amount: float = Field(gt=0)
    description: str | None = None


def _member_ids(project) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for uid in [project.customer_id, project.contractor_id, project.foreman_id]:
        if uid and uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out


@router.get("")
async def list_co(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    items = await co_svc.list_orders(db, project_id)
    return [{"id": x.id, "title": x.title, "amount": x.amount, "status": x.status.value, "description": x.description} for x in items]


@router.post("")
async def create_co(project_id: str, body: ChangeOrderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    co = await co_svc.create_order(db, project_id, user.id, body.title, body.amount, body.description)
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="ChangeOrderCreated",
        title=f"Доп. работы: {co.title}",
        body=body.description,
        link_path="/(customer)/(tabs)/budget",
    )
    if project.customer_id:
        await notif.notify(
            db,
            user_id=project.customer_id,
            project_id=project_id,
            notification_type="change_order",
            title=f"Согласуйте доп. работы: {co.title}",
            body=f"{co.amount:.0f} ₽",
            link_path="/(customer)/(tabs)/budget",
            return_to="/(customer)/(tabs)/home",
        )
    return {"id": co.id, "status": co.status.value}


@router.post("/{order_id}/approve")
async def approve_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    co = await co_svc.approve(db, order_id)
    if not co:
        raise HTTPException(404)
    from app.models.project_documents import DocumentStatus, DocumentType
    from app.services import project_document_service as docs_svc

    draft = await docs_svc.create_document(
        db,
        project_id=project_id,
        created_by=user.id,
        title=f"Доп. работы: {co.title}",
        document_type=DocumentType.contract.value,
        notes=f"CO:{co.id}; сумма {co.amount:.0f} ₽; черновик для подписи",
    )
    draft.status = DocumentStatus.draft.value
    await db.flush()
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="ChangeOrderApproved",
        title=f"Доп. работы согласованы: {co.title}",
        body=str(co.amount),
        link_path="/(customer)/(tabs)/budget",
    )
    for member_id in _member_ids(project):
        if member_id == user.id:
            continue
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project_id,
            notification_type="change_order",
            title=f"Доп. работы согласованы: {co.title}",
            body=str(co.amount),
            link_path="/(contractor)/(tabs)/budget",
            return_to="/(contractor)/(tabs)/home",
        )
    await db.commit()
    return {"ok": True, "status": co.status.value}


@router.post("/{order_id}/reject")
async def reject_co(project_id: str, order_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer:
        raise HTTPException(403)
    co = await co_svc.reject(db, order_id)
    if not co:
        raise HTTPException(404)
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="ChangeOrderRejected",
        title=f"Доп. работы отклонены: {co.title}",
        body=co.description,
        link_path="/(customer)/(tabs)/budget",
    )
    for member_id in _member_ids(project):
        if member_id == user.id:
            continue
        await notif.notify(
            db,
            user_id=member_id,
            project_id=project_id,
            notification_type="change_order",
            title=f"Доп. работы отклонены: {co.title}",
            body=co.description or "",
            link_path="/(contractor)/(tabs)/budget",
            return_to="/(contractor)/(tabs)/home",
        )
    return {"ok": True, "status": co.status.value}
