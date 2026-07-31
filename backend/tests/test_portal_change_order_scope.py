from __future__ import annotations

import inspect

import pytest
from fastapi import HTTPException

from app.api.v1 import portal


class _NoDbAccess:
    async def get(self, *_args, **_kwargs):
        raise AssertionError("database must not be touched before portal scope validation")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [portal.portal_approve_change_order, portal.portal_reject_change_order],
)
async def test_pay_only_portal_token_cannot_decide_change_order(monkeypatch, endpoint):
    monkeypatch.setattr(
        portal.portal_tok,
        "verify_portal_token",
        lambda _token: {
            "project_id": "project-1",
            "user_id": "customer-1",
            "scopes": ["read", "pay"],
        },
    )

    with pytest.raises(HTTPException) as exc:
        await endpoint(
            "project-1",
            "change-order-1",
            portal.PortalChangeOrderIn(token="pay-only-token"),
            _NoDbAccess(),
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "portal_accept_stage_scope_required"


@pytest.mark.parametrize(
    "endpoint",
    [portal.portal_approve_change_order, portal.portal_reject_change_order],
)
def test_change_order_endpoint_uses_canonical_scope_guard(endpoint):
    source = inspect.getsource(endpoint)

    assert "claims = _portal_claims(body.token, project_id)" in source
    assert '_require_portal_scope(claims, "accept_stage")' in source
    assert "portal_tok.verify_portal_token" not in source
    assert source.index("_require_portal_scope") < source.index("await db.get")
