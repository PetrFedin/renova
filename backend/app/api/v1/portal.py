"""Web client portal — magic link + read-only snapshot (P2.1)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Project, User, UserRole
from app.services import portal_token_service as portal_tok
from app.services import team_service as team_svc

router = APIRouter(tags=["portal"])


class PortalSessionIn(BaseModel):
    token: str


class PortalLinkOut(BaseModel):
    token: str
    url: str
    expires_hours: int = 168


@router.post("/auth/portal/session")
async def portal_session(body: PortalSessionIn, db: AsyncSession = Depends(get_db)):
    """Обмен magic link JWT → user_id + project (без пароля; гость должен быть в project_viewers)."""
    try:
        claims = portal_tok.verify_portal_token(body.token)
    except ValueError:
        raise HTTPException(401, "invalid_portal_token")

    from sqlalchemy import select

    user = await db.get(User, claims["user_id"])
    if not user:
        raise HTTPException(401, "user_not_found")
    project = await db.get(Project, claims["project_id"])
    if not project:
        raise HTTPException(404, "project_not_found")

    mode, read_only = await team_svc.project_access_mode(db, user, project)
    if mode == "none":
        raise HTTPException(403, "no_access")
    if claims["project_id"] != project.id or claims["user_id"] != user.id:
        raise HTTPException(401, "token_mismatch")

    return {
        "user_id": user.id,
        "project_id": project.id,
        "project_name": project.name,
        "read_only": read_only,
        "access_mode": mode,
        "role": user.role.value,
    }


@router.post("/projects/{project_id}/viewers/{viewer_user_id}/portal-link", response_model=PortalLinkOut)
async def create_viewer_portal_link(
    project_id: str,
    viewer_user_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Заказчик: magic link для гостя (read-only web portal)."""
    p = await require_project(db, project_id, user, write=True)
    if user.id != p.customer_id:
        raise HTTPException(403, "Только заказчик")

    from sqlalchemy import select
    from app.models.entities import ProjectViewer

    row = (
        await db.execute(
            select(ProjectViewer).where(
                ProjectViewer.project_id == project_id,
                ProjectViewer.user_id == viewer_user_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "viewer_not_found")

    guest = await db.get(User, viewer_user_id)
    if not guest:
        raise HTTPException(404, "viewer_not_found")

    token = portal_tok.create_portal_token(project_id=project_id, user_id=viewer_user_id)
    return PortalLinkOut(token=token, url=portal_tok.portal_url(token))


@router.get("/portal/projects/{project_id}/snapshot")
async def portal_snapshot(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read-only сводка для web portal: расписание, документы, оплаты."""
    p = await require_project(db, project_id, user, write=False)
    mode, read_only = await team_svc.project_access_mode(db, user, p)

    from app.services import schedule_service as sched
    from app.services import payment_service as pay_svc
    from app.services import project_document_service as docs_svc
    from sqlalchemy import select
    from app.models.entities import SelectionItem
    from app.api.v1.selections import _out as selection_out

    schedule = await sched.build_schedule_summary(db, p)
    payments = await pay_svc.list_payments(db, project_id)
    pending = [pay_svc.payment_dict(x) for x in payments if x.status.value == "pending"]
    canonical = await docs_svc.list_canonical_documents(db, project_id)
    sel_rows = (
        await db.execute(
            select(SelectionItem).where(SelectionItem.project_id == project_id).order_by(SelectionItem.created_at.desc())
        )
    ).scalars().all()
    selections = [selection_out(r) for r in sel_rows[:15]]

    return {
        "project": {"id": p.id, "name": p.name, "address": p.address, "progress_percent": p.progress_percent},
        "read_only": read_only,
        "access_mode": mode,
        "schedule": schedule,
        "pending_payments": pending,
        "documents": canonical[:20],
        "documents_total": len(canonical),
        "selections": selections,
        "selections_total": len(sel_rows),
    }
