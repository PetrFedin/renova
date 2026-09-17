"""A portal access token is bound to one project and one set of scopes.

`POST /auth/portal/session` exchanges a magic link for an ordinary access JWT,
because the portal snapshot and the checkout route need `Authorization: Bearer`
like any other request. The token carried `portal: True` and `project_id`, but
nothing read them: `get_current_user` and `require_project` see only the user.

So a link issued for one project, marked read-only, was a full session for that
user everywhere:

    portal-link  {project_id: A, scopes: ["read"], read_only: true}
      → /auth/portal/session → access_token
      → GET   /projects/B     → 200   (another project entirely)
      → PATCH /projects/B     → 200   (a write, from a read-only link)

The link is sent by SMS or email, so it lives in message history and carrier
logs. Whoever holds it held the whole account.

This module is the missing half. A portal token may be used only:

  - on a route bound to its own project, compared on the resolved path
    parameter rather than on the URL string;
  - with a method its scopes allow — ``read`` alone means safe methods only.

Everything else is refused with 403 before the route body runs. A token without
``portal: True`` is untouched, so ordinary sessions are unaffected.
"""

from __future__ import annotations

from fastapi import HTTPException, Request

#: Methods that cannot change state, so a read-only link may use them.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

#: Scopes that authorize a state change. ``read`` is deliberately absent.
WRITE_SCOPES = frozenset({"accept_stage", "sign_document", "pay"})

#: Routes a portal session legitimately needs that carry no project id.
#:
#: The portal screen calls ``/auth/me`` to resolve who the link belongs to.
#: Keep this list closed and small — every entry is a route a leaked link can
#: reach, so anything added here must be safe for a stranger to call.
PROJECTLESS_READS = frozenset({"/api/v1/auth/me"})


def portal_claims(payload: dict | None) -> dict | None:
    """The payload if it is a portal token, otherwise None."""
    if not payload or not payload.get("portal"):
        return None
    return payload


def enforce_portal_scope(request: Request, payload: dict | None) -> None:
    """Refuse a portal token used outside its project or beyond its scopes.

    Raises HTTPException(403). Does nothing for a normal access token.
    """
    claims = portal_claims(payload)
    if claims is None:
        return

    scopes = set(claims.get("scopes") or ["read"])
    method = request.method.upper()

    if method not in SAFE_METHODS and not (scopes & WRITE_SCOPES):
        raise HTTPException(403, "portal_token_read_only")

    path = request.url.path
    if method in SAFE_METHODS and path in PROJECTLESS_READS:
        return

    bound = claims.get("project_id")
    # Resolved by the router before dependencies run, so this is the project the
    # handler will actually act on — not a substring of the URL.
    requested = request.path_params.get("project_id")

    if not bound or not requested or requested != bound:
        raise HTTPException(403, "portal_token_project_mismatch")
