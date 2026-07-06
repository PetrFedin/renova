from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import activity_service as act

router = APIRouter(prefix="/projects", tags=["activity"])

@router.get("/{project_id}/activity")
async def activity_feed(project_id: str, kind: str | None = None, work_type: str | None = None, room_id: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    return await act.project_feed(db, project_id, kind=kind, work_type=work_type, room_id=room_id)
