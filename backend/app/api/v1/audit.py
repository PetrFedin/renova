from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.db.session import get_db
from app.models.entities import AuditLog, User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/logs")
async def audit_logs(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100)
    )
    return [
        {
            "id": row.id,
            "method": row.method,
            "path": row.path,
            "status_code": row.status_code,
            "user_id": row.user_id,
            "created_at": row.created_at.isoformat(),
        }
        for row in result.scalars().all()
    ]
