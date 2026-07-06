from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import AuditLog, User, UserRole

router = APIRouter(prefix="/audit", tags=["audit"])

@router.get("/logs")
async def audit_logs(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    r = await db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100))
    return [{"id": x.id, "method": x.method, "path": x.path, "status_code": x.status_code, "user_id": x.user_id, "created_at": x.created_at.isoformat()} for x in r.scalars().all()]
