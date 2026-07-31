"""Role-aware QC issue transitions: start, fixed, verify, rework and reopen."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import ProjectIssue, User
from app.services import issue_service as issue_svc

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
        raise HTTPException(
            409,
            detail={
                "code": "warranty_transition_separate",
                "message": "Гарантийные обращения закрываются через гарантийный контур.",
            },
        )

    current = issue.status
    try:
        issue = await issue_svc.transition_issue(
            db,
            issue,
            body.status,
            user.role,
            commit=False,
        )
    except ValueError as error:
        code = str(error)
        if code == "issue_transition_role_forbidden":
            raise HTTPException(
                403,
                detail={
                    "code": code,
                    "message": "Этот переход недоступен для вашей роли.",
                },
            ) from error
        raise HTTPException(
            409,
            detail={
                "code": code,
                "message": "Статус замечания уже изменился или переход недоступен.",
            },
        ) from error

    try:
        await issue_svc.prepare_issue_transition_effects(
            db,
            project=project,
            issue=issue,
            actor_id=user.id,
            previous_status=current,
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise

    await db.refresh(issue)

    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source="issue.transition",
        limit=10,
    )
    return issue_svc.issue_dict(issue)
