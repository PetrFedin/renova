"""Role-aware navigation links for notifications (COM-020, COM-002).

Emitters historically hard-code the ``/(customer)/...`` route group even when
the recipient is the contractor, so a tap landed in the wrong role's screens.
``link_for_role`` is the single place that rewrites a route for the
recipient's role; ``notify``/``notify_from_outbox`` apply it to every link
before it is stored or pushed, and ``recipient_role`` resolves that role from
the recipient account (the same ``user.role`` the mobile session navigates by).
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import User

ROLES = ("customer", "contractor")
_GROUP_PREFIX = {role: f"/({role})/" for role in ROLES}
_GROUP_BARE = {role: f"/({role})" for role in ROLES}


def link_for_role(path: str | None, role: str | None) -> str | None:
    """Return ``path`` expressed in ``role``'s route group.

    Role-agnostic routes (``/stage/..``, ``/documents``, ``/control`` ...) and
    unknown roles pass through unchanged; only the leading ``(customer)`` /
    ``(contractor)`` group segment is swapped. Idempotent.
    """
    if not path or role not in ROLES:
        return path
    for other in ROLES:
        if other == role:
            continue
        prefix = _GROUP_PREFIX[other]
        if path.startswith(prefix):
            return _GROUP_PREFIX[role] + path[len(prefix):]
        bare = _GROUP_BARE[other]
        if path == bare or path.startswith(bare + "?"):
            return _GROUP_BARE[role] + path[len(bare):]
    return path


async def recipient_role(db: AsyncSession, user_id: str) -> str | None:
    """Role the recipient navigates by (``User.role``); None when unknown."""
    user = await db.get(User, user_id)
    value = getattr(getattr(user, "role", None), "value", getattr(user, "role", None))
    return value if value in ROLES else None
