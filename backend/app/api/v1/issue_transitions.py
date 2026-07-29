"""Role-aware QC issue transitions: start, fixed, verify, rework and reopen."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import ProjectIssue, User
from app.services import activity_service as act
from app.services import issue_service as issue_svc
from app.services import notification_service as notif_svc

router = APIRouter(tags=["issue-transitions"])


class IssueTransitionIn(BaseModel):
    status: str


@router.post("/projects/{project_id}/issues/{issue_id}/transition")
async def transition_issue(
    project_id: str,
    issue_id: str,
    body: IssueTransitionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    issue = await db.get(ProjectIssue, issue_id)
    if not issue or issue.project_id != project_id:
        raise HTTPException(404)
    if (issue.title or "").startswith("[Гарантия]"):
        raise HTTPException(409, detail={
            "code": "warranty_transition_separate",
            "message": "Гарантийные обращения закрываются через гарантийный контур.",
        })

    current = issue.status
    try:
        issue = await issue_svc.transition_issue(db, issue, body.status, user.role)
    except ValueError as error:
        code = str(error)
        if code == "issue_transition_role_forbidden":
            raise HTTPException(403, detail={
                "code": code,
                "message": "Этот переход недоступен для вашей роли.",
            }) from error
        raise HTTPException(409, detail={
            "code": code,
            "message": "Статус замечания уже изменился или переход недоступен.",
        }) from error

    event_kind, event_body = issue_svc.issue_transition_event(current, issue.status)
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind=event_kind,
        title=issue.title,
        body=f"{current} → {issue.status}. {event_body}",
        room_id=issue.room_id,
        stage_id=issue.stage_id,
        link_path="/control",
    )

    notification_type, title, message = issue_svc.issue_transition_notification(
        current,
        issue.status,
        issue.title,
    )
    for target_id in issue_svc.issue_transition_targets(project, user.id):
        await notif_svc.notify(
            db,
            user_id=target_id,
            project_id=project_id,
            notification_type=notification_type,
            title=title,
            body=message,
            link_path="/control",
        )

    return issue_svc.issue_dict(issue)
