"""JRN-027: после closeout проект заперт — смета, график, счета и этапы не меняются.

Один router-level guard вместо правки каждого роута. Разрешено остаётся: чтение,
гарантийный контур, замечания, чаты, документы, споры по уже проведённым платежам
и комментарии/реакции этапа. «Открыть заново» (restore) намеренно не предусмотрено.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.entities import Project

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# Первый сегмент пути после /projects/{id}/, изменения которого после closeout запрещены.
LOCKED_SEGMENTS = frozenset(
    {"payments", "change-orders", "estimate", "work-schedules", "stages", "work-acceptances"}
)
# Подпути, остающиеся доступными внутри запертого сегмента.
_ALLOWED_SUBPATHS = ("/dispute", "/comments", "/reactions", "/receipts")


def is_locked_mutation(method: str, path: str, project_id: str) -> bool:
    if method.upper() in _SAFE_METHODS:
        return False
    marker = f"/projects/{project_id}/"
    if marker not in path:
        return False
    rest = path.split(marker, 1)[1]
    segment = rest.split("/", 1)[0]
    if segment not in LOCKED_SEGMENTS:
        return False
    return not any(allowed in f"/{rest}" for allowed in _ALLOWED_SUBPATHS)


async def project_closed_guard(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    project_id = request.path_params.get("project_id")
    if not project_id or not is_locked_mutation(request.method, request.url.path, str(project_id)):
        return
    project = await db.get(Project, str(project_id))
    if project is None or not bool(getattr(project, "is_archived", False)):
        return
    raise HTTPException(
        409,
        detail={
            "code": "project_closed",
            "message": "Проект завершён: смета, график, счета и этапы больше не меняются. "
            "Доступны чтение и гарантийные обращения.",
        },
    )
