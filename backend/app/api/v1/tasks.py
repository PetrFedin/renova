"""Task counters SoT — агрегаты для dock / inbox / calendar."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import task_counters_service as counters_svc

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/counters")
async def get_task_counters(
    project_id: str = Query(..., alias="project"),
    role: str = Query("customer"),
    timezone: str = Query("Europe/Moscow"),
    status: str | None = Query(None, description="reserved"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Единый snapshot счётчиков задач.

    Клиент применяет ответ целиком (revision). date «сегодня» — в `timezone`.
    """
    await require_project(db, project_id, user, write=False)
    return await counters_svc.build_task_counters(
        db,
        project_id=project_id,
        role=role,
        timezone=timezone,
    )
