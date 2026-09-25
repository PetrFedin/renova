from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project_dep
from app.db.session import get_db
from app.models.entities import CommentReaction, Stage, StageComment, User

router = APIRouter(prefix="/projects", tags=["reactions"])


class ReactIn(BaseModel):
    reaction: str


async def _require_scoped_stage(db: AsyncSession, *, project_id: str, stage_id: str) -> None:
    stage = (
        await db.execute(
            select(Stage.id).where(
                Stage.id == stage_id,
                Stage.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if stage is None:
        raise HTTPException(404)


async def _require_scoped_comment(
    db: AsyncSession,
    *,
    project_id: str,
    stage_id: str,
    comment_id: str,
) -> StageComment:
    comment = (
        await db.execute(
            select(StageComment)
            .join(Stage, Stage.id == StageComment.stage_id)
            .where(
                StageComment.id == comment_id,
                StageComment.stage_id == stage_id,
                Stage.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(404)
    return comment


@router.post("/{project_id}/stages/{stage_id}/comments/{comment_id}/react")
async def react(
    project_id: str,
    stage_id: str,
    comment_id: str,
    body: ReactIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_project_dep()),
):
    comment = await _require_scoped_comment(
        db,
        project_id=project_id,
        stage_id=stage_id,
        comment_id=comment_id,
    )
    await db.execute(
        delete(CommentReaction).where(
            CommentReaction.comment_id == comment_id,
            CommentReaction.user_id == user.id,
        )
    )
    if body.reaction:
        db.add(CommentReaction(comment_id=comment_id, user_id=user.id, reaction=body.reaction))
    await db.commit()

    if body.reaction and comment.user_id != user.id:
        from app.services import notification_service as ns

        await ns.notify(
            db,
            user_id=comment.user_id,
            project_id=project_id,
            notification_type="reaction",
            title=f"Реакция {body.reaction}",
            body=comment.text[:80],
            link_path=f"/stage/{stage_id}",
            return_to="/stage/" + stage_id,
        )

    result = await db.execute(
        select(CommentReaction).where(CommentReaction.comment_id == comment_id)
    )
    return {
        "reactions": [
            {"user_id": item.user_id, "reaction": item.reaction}
            for item in result.scalars().all()
        ]
    }


@router.get("/{project_id}/stages/{stage_id}/comments/{comment_id}/react")
async def get_reacts(
    project_id: str,
    stage_id: str,
    comment_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_project_dep()),
):
    await _require_scoped_comment(
        db,
        project_id=project_id,
        stage_id=stage_id,
        comment_id=comment_id,
    )
    result = await db.execute(
        select(CommentReaction).where(CommentReaction.comment_id == comment_id)
    )
    return {
        "reactions": [
            {"user_id": item.user_id, "reaction": item.reaction}
            for item in result.scalars().all()
        ]
    }


@router.get("/{project_id}/stages/{stage_id}/reaction-counts")
async def reaction_counts(
    project_id: str,
    stage_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_project_dep()),
):
    await _require_scoped_stage(db, project_id=project_id, stage_id=stage_id)
    comment_ids = (
        await db.execute(select(StageComment.id).where(StageComment.stage_id == stage_id))
    ).scalars().all()
    out = {}
    for comment_id in comment_ids:
        counts = await db.execute(
            select(CommentReaction.reaction, func.count())
            .where(CommentReaction.comment_id == comment_id)
            .group_by(CommentReaction.reaction)
        )
        users = await db.execute(
            select(CommentReaction).where(CommentReaction.comment_id == comment_id)
        )
        out[comment_id] = {
            "counts": {row[0]: row[1] for row in counts.all()},
            "users": [
                {"user_id": item.user_id, "reaction": item.reaction}
                for item in users.scalars().all()
            ],
        }
    return out
