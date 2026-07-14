"""ACL для ключей media под documents/{project_id}/… (Wave 3).

Зачем:
- Soft ACL (только наличие X-User-Id) не защищает от угадывания UUID проекта.
- Privacy-404 как у Document Center (D-07): чужой проект не раскрываем.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import User
from app.services import project_service as proj_svc
from app.services import team_service as team_svc

# Project.id — UUID или короткий id из сидов
_PROJECT_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    r"|^[0-9a-fA-F]{32}$"
    r"|^[0-9a-zA-Z_-]{8,64}$"
)


@dataclass(frozen=True)
class DocumentMediaKey:
    project_id: str
    relative_path: str  # всё после project_id/


def parse_document_media_key(storage_key: str) -> DocumentMediaKey | None:
    """Извлечь project_id из documents/{project_id}/…. Иначе None."""
    key = (storage_key or "").lstrip("/")
    if not key.startswith("documents/"):
        return None
    rest = key[len("documents/") :]
    if not rest or "/" not in rest:
        return None
    project_id, relative = rest.split("/", 1)
    if not project_id or not relative or ".." in relative.split("/"):
        return None
    if not _PROJECT_ID_RE.match(project_id):
        return None
    return DocumentMediaKey(project_id=project_id, relative_path=relative)


async def assert_document_media_access(
    db: AsyncSession,
    user: User,
    storage_key: str,
    *,
    write: bool = False,
) -> DocumentMediaKey:
    """Проверить membership. Чужой / нет проекта → 404 (не 403)."""
    parsed = parse_document_media_key(storage_key)
    if parsed is None:
        raise HTTPException(400, "invalid_document_media_key")
    project = await proj_svc.get_project(db, parsed.project_id)
    if not project:
        raise HTTPException(404, "document_or_project_not_found")
    if not await team_svc.can_access_project(db, user, project, write=write):
        raise HTTPException(404, "document_or_project_not_found")
    return parsed
