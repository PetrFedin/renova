"""Administrative RBAC dependency.

Contractor is a commercial role, not an administrator role.  Development/test
retain the historical contractor fallback for local demos; staging/production
require an explicit immutable user id in ADMIN_USER_IDS.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException

from app.api.deps import get_current_user
from app.core.config import settings
from app.models.entities import User, UserRole

_WORKING_ENVIRONMENTS = {"staging", "production"}


def admin_access_state(user: User) -> tuple[bool, str]:
    if user.role != UserRole.contractor:
        return False, "admin_role_forbidden"

    configured = settings.admin_user_id_set
    environment = settings.normalized_environment
    if environment in _WORKING_ENVIRONMENTS:
        if not configured:
            return False, "admin_access_not_configured"
        if user.id not in configured:
            return False, "admin_identity_forbidden"
        return True, "explicit_admin_identity"

    if configured:
        if user.id not in configured:
            return False, "admin_identity_forbidden"
        return True, "explicit_admin_identity"
    return True, "local_contractor_fallback"


async def require_admin_user(
    user: User = Depends(get_current_user),
) -> User:
    allowed, reason = admin_access_state(user)
    if not allowed:
        # Avoid disclosing the configured administrator universe.
        raise HTTPException(
            403,
            detail={
                "code": reason,
                "message": "Административный доступ запрещён",
            },
        )
    return user
