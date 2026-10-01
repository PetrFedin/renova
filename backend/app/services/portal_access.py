"""Authorise a portal magic link against current state, not just its signature.

``verify_portal_token`` proves two things: the token was signed by this
deployment, and it has not expired. Everything the authenticated API checks on
every request was missing on this path:

* ``deps.get_current_user`` rejects a user with ``deleted_at`` — the portal did
  not load that field at all;
* ``deps._validate_access_session`` rejects an access token issued before
  ``user.tokens_invalid_before``, which is how "sign out everywhere" and an
  operator revoke actually take effect — the portal had no equivalent;
* ``deps.require_project`` rejects a project with ``trashed_at`` and re-checks
  project access on every call — the portal only compared the project id
  embedded in the token.

A portal token carries write scopes (``accept_stage``, ``pay``,
``sign_document``) and a 7-day default TTL, and it travels by SMS or email, so
it lands in message history, carrier logs and screenshots. Before this module a
leaked or mis-sent link kept working for the rest of that week even after the
account was deleted, the sessions were revoked, the participant was removed
from the project, or the project was moved to the trash.

Signature and expiry are necessary, not sufficient. Every portal entry point
resolves through ``authorize_portal``.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, User
from app.services import portal_token_service as portal_tokens
from app.services import team_service as team_svc


@dataclass(frozen=True, slots=True)
class PortalAccess:
    """A magic link that is still valid against current state."""

    user: User
    project: Project
    scopes: tuple[str, ...]
    read_only: bool

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes


def _reject(status: int, code: str) -> HTTPException:
    return HTTPException(status, code)


def _issued_before_revocation(issued_at: int | None, cutoff: datetime | None) -> bool:
    """Whether a revoke-all happened after this token was minted."""
    if cutoff is None or issued_at is None:
        return False
    # tokens_invalid_before is stored naive UTC (see app.core.timeutil).
    return float(issued_at) < cutoff.replace(tzinfo=None).timestamp()


async def authorize_portal(
    db: AsyncSession,
    *,
    token: str,
    project_id: str,
    required_scope: str | None = None,
) -> PortalAccess:
    """Verify a magic link and re-prove it against current state.

    Raises 401 for an unusable credential, 403 for a usable credential that is
    not allowed to do this, 404 for a project that is gone.
    """
    try:
        claims = portal_tokens.verify_portal_token(token)
    except ValueError as exc:
        raise _reject(401, "invalid_portal_token") from exc

    if claims.get("project_id") != project_id:
        raise _reject(401, "token_mismatch")

    scopes = tuple(claims.get("scopes") or ["read"])
    # A missing scope is a property of the token alone. Reject it before any
    # database access, both because it is cheaper and because the existing
    # contract (test_portal_change_order_scope, test_portal_schedule_closeout)
    # requires a wrong-scope token to be refused without touching the database.
    if required_scope is not None and required_scope not in scopes:
        raise _reject(403, f"portal_{required_scope}_scope_required")

    user = await db.get(User, claims.get("user_id"))
    if user is None:
        raise _reject(401, "user_not_found")
    if getattr(user, "deleted_at", None) is not None:
        raise _reject(401, "account_deleted")

    if _issued_before_revocation(
        claims.get("issued_at"),
        getattr(user, "tokens_invalid_before", None),
    ):
        raise _reject(401, "portal_token_revoked")

    project = await db.get(Project, project_id)
    if project is None:
        raise _reject(404, "project_not_found")
    if getattr(project, "trashed_at", None) is not None:
        raise _reject(404, "project_not_found")

    # The participant may have been removed after the link was sent.
    mode, project_read_only = await team_svc.project_access_mode(db, user, project)
    if mode == "none":
        raise _reject(403, "portal_access_revoked")

    read_only = bool(claims.get("read_only", True)) or bool(project_read_only)

    return PortalAccess(
        user=user,
        project=project,
        scopes=scopes,
        read_only=read_only,
    )


def require_scope(access: PortalAccess, scope: str) -> None:
    if not access.has_scope(scope):
        raise _reject(403, f"portal_{scope}_scope_required")
