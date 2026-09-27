from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project, require_project_dep
from app.db.session import get_db
from app.models.entities import User, CommentReaction, Stage, StageComment

router = APIRouter(prefix="/projects", tags=["reactions"])

class ReactIn(BaseModel):
    reaction: str


async def _resolve_scoped_comment(
    db: AsyncSession, project_id: str, stage_id: str, comment_id: str
) -> StageComment:
    """Prove Stage.id == stage_id belongs to project_id AND the comment belongs to that stage.

    Fails closed with 404 before any read/mutation of reaction rows, so a caller
    authorized only to project_id cannot read or write reactions on a stage/comment
    that actually belongs to a different project.
    """
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    comment = await db.get(StageComment, comment_id)
    if not comment or comment.stage_id != stage_id:
        raise HTTPException(404, "Комментарий не найден")
    return comment


async def _resolve_scoped_stage(db: AsyncSession, project_id: str, stage_id: str) -> Stage:
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    return stage


@router.post("/{project_id}/stages/{stage_id}/comments/{comment_id}/react")
async def react(project_id: str, stage_id: str, comment_id: str, body: ReactIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    c = await _resolve_scoped_comment(db, project_id, stage_id, comment_id)
    await db.execute(delete(CommentReaction).where(CommentReaction.comment_id == comment_id, CommentReaction.user_id == user.id))
    if body.reaction:
        db.add(CommentReaction(comment_id=comment_id, user_id=user.id, reaction=body.reaction))
    await db.commit()
    if c and body.reaction and c.user_id != user.id:
        from app.services import notification_service as ns
        await ns.notify(db, user_id=c.user_id, project_id=project_id, notification_type='reaction', title=f'Реакция {body.reaction}', body=c.text[:80], link_path=f'/stage/{stage_id}', return_to='/stage/' + stage_id)
    r = await db.execute(select(CommentReaction).where(CommentReaction.comment_id == comment_id))
    return {"reactions": [{"user_id": x.user_id, "reaction": x.reaction} for x in r.scalars().all()]}

@router.get("/{project_id}/stages/{stage_id}/comments/{comment_id}/react")
async def get_reacts(project_id: str, stage_id: str, comment_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    await _resolve_scoped_comment(db, project_id, stage_id, comment_id)
    r = await db.execute(select(CommentReaction).where(CommentReaction.comment_id == comment_id))
    return {"reactions": [{"user_id": x.user_id, "reaction": x.reaction} for x in r.scalars().all()]}

@router.get("/{project_id}/stages/{stage_id}/reaction-counts")
async def reaction_counts(project_id: str, stage_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _=Depends(require_project_dep())):
    from sqlalchemy import select, func
    await _resolve_scoped_stage(db, project_id, stage_id)
    comments = (await db.execute(select(StageComment.id).where(StageComment.stage_id == stage_id))).scalars().all()
    out = {}
    for cid in comments:
        r = await db.execute(select(CommentReaction.reaction, func.count()).where(CommentReaction.comment_id == cid).group_by(CommentReaction.reaction))
        out[cid] = {"counts": {row[0]: row[1] for row in r.all()}, "users": [{"user_id": x.user_id, "reaction": x.reaction} for x in (await db.execute(select(CommentReaction).where(CommentReaction.comment_id == cid))).scalars().all()]}
    return out
