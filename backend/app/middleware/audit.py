from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.db.session import SessionLocal
from app.models.entities import AuditLog
from app.core.request_auth import audit_user_id


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method in ("POST", "PATCH", "PUT", "DELETE") and request.url.path.startswith("/api/"):
            try:
                async with SessionLocal() as db:
                    db.add(AuditLog(
                        user_id=audit_user_id(
                            authorization=request.headers.get("Authorization"),
                            x_user_id=request.headers.get("X-User-Id"),
                        ),
                        method=request.method,
                        path=str(request.url.path)[:512],
                        status_code=response.status_code,
                    ))
                    await db.commit()
            except Exception:
                pass
        return response
