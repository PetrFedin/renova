"""Inbox чатов — project membership + exact invited threads."""
from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, ProjectViewer, User, UserRole
from app.models.technical_supervision import ProjectTechnicalSupervisorAssignment
from app.services import team_service as team_svc
from app.services import technical_supervision_service as supervision
from app.services import chat_participant_service as participant_svc
from app.services import chat_service as chat_svc
from app.services.chat_acl import must_hide_money_threads

router = APIRouter(prefix="/chats", tags=["chats-inbox"])


async def _user_projects(db: AsyncSession, user: User) -> list[tuple[str, str]]:
    """Проекты, чаты которых пользователь вправе видеть (COM-005/COM-007).

    Те же роли, что у `project_access_mode`: владелец, ведущий исполнитель,
    члены его бригады, гости и назначенный технадзор. Проекты в корзине
    исключены (их тред всё равно не открыть), поэтому и список, и счётчик
    «непрочитано» считаются по одному набору. Архивные проекты остаются: чат
    архивного объекта доступен, а скрытие делается локальным фильтром «Архив».
    """
    owners = await team_svc.team_owner_ids(db, user.id)
    conditions = [
        Project.customer_id == user.id,
        Project.contractor_id == user.id,
        Project.id.in_(select(ProjectViewer.project_id).where(ProjectViewer.user_id == user.id)),
        Project.id.in_(
            select(ProjectTechnicalSupervisorAssignment.project_id).where(
                ProjectTechnicalSupervisorAssignment.representative_user_id == user.id,
                ProjectTechnicalSupervisorAssignment.revoked_at.is_(None),
            )
        ),
    ]
    if owners and user.role == UserRole.contractor:
        conditions.append(Project.contractor_id.in_(owners))
    r = await db.execute(
        select(Project).where(or_(*conditions), Project.trashed_at.is_(None))
    )
    out: list[tuple[str, str]] = []
    for p in r.scalars().all():
        if p.customer_id != user.id and p.contractor_id != user.id:
            # отозванный/конфликтный технадзор и «участник» без доступа к чату — не показываем
            mode, _ = await team_svc.project_access_mode(db, user, p)
            if mode in ("none", "participant") and not await supervision.is_active_supervisor(
                db, project_id=p.id, user_id=user.id
            ):
                continue
        out.append((p.id, p.name))
    return out


async def _money_hidden_projects(db: AsyncSession, user: User, projects: list[tuple[str, str]]) -> set[str]:
    """COM-036: projects where the viewer is a guest/read-only team viewer (money threads hidden)."""
    hidden: set[str] = set()
    for project_id, _name in projects:
        project = await db.get(Project, project_id)
        if project is not None and await must_hide_money_threads(db, project, user):
            hidden.add(project_id)
    return hidden


def _sort_inbox(items: list[dict]) -> list[dict]:
    items.sort(
        key=lambda item: (
            not item.get("is_pinned"),
            item.get("pinned_at") or "",
            item.get("updated_at") or "",
        ),
        reverse=True,
    )
    return items


@router.get("/inbox")
async def inbox(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    projects = await _user_projects(db, user)
    member_project_ids = {project_id for project_id, _name in projects}
    hide_money = await _money_hidden_projects(db, user, projects)
    member_items = await chat_svc.list_inbox(db, user.id, projects, hide_money_projects=hide_money)
    participant_items = await participant_svc.participant_inbox(
        db,
        user_id=user.id,
        exclude_project_ids=member_project_ids,
    )
    return _sort_inbox(member_items + participant_items)


@router.get("/unread-total")
async def unread_total(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    projects = await _user_projects(db, user)
    ids = [project_id for project_id, _name in projects]
    hide_money = await _money_hidden_projects(db, user, projects)
    count = await chat_svc.count_unread_all(db, user.id, ids, hide_money_projects=hide_money)
    count += await participant_svc.participant_unread_total(
        db,
        user_id=user.id,
        exclude_project_ids=set(ids),
    )
    return {"count": count}
