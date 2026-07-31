from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1 import portal
from app.api.v1 import portal_change_order_decisions as decisions
from app.api.v1.router import api_router
from app.models.entities import Project, User, UserRole


class _NoDbAccess:
    async def get(self, *_args, **_kwargs):
        raise AssertionError("database must not be touched before portal scope validation")


class _CustomerDb:
    def __init__(self):
        self.user = SimpleNamespace(id="customer-1", role=UserRole.customer)
        self.project = SimpleNamespace(id="project-1", customer_id="customer-1")

    async def get(self, model, identity):
        if model is User and identity == "customer-1":
            return self.user
        if model is Project and identity == "project-1":
            return self.project
        return None


def _claims(scopes: list[str]) -> dict:
    return {
        "project_id": "project-1",
        "user_id": "customer-1",
        "scopes": scopes,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [decisions.portal_approve_change_order, decisions.portal_reject_change_order],
)
async def test_pay_only_portal_token_cannot_decide_change_order(monkeypatch, endpoint):
    monkeypatch.setattr(portal.portal_tok, "verify_portal_token", lambda _token: _claims(["read", "pay"]))

    with pytest.raises(HTTPException) as exc:
        await endpoint(
            "project-1",
            "change-order-1",
            decisions.PortalChangeOrderDecisionIn(token="pay-only-token"),
            _NoDbAccess(),
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "portal_accept_stage_scope_required"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [decisions.portal_approve_change_order, decisions.portal_reject_change_order],
)
async def test_wrong_project_token_is_rejected_before_database_access(monkeypatch, endpoint):
    monkeypatch.setattr(
        portal.portal_tok,
        "verify_portal_token",
        lambda _token: {
            "project_id": "other-project",
            "user_id": "customer-1",
            "scopes": ["read", "accept_stage"],
        },
    )

    with pytest.raises(HTTPException) as exc:
        await endpoint(
            "project-1",
            "change-order-1",
            decisions.PortalChangeOrderDecisionIn(token="wrong-project-token"),
            _NoDbAccess(),
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "token_project_mismatch"


@pytest.mark.asyncio
async def test_reject_uses_project_scoped_service_and_actual_customer(monkeypatch):
    monkeypatch.setattr(
        portal.portal_tok,
        "verify_portal_token",
        lambda _token: _claims(["read", "accept_stage"]),
    )
    captured: dict[str, str] = {}

    async def fake_reject_with_effects(db, *, project_id, order_id, rejected_by):
        captured.update(
            project_id=project_id,
            order_id=order_id,
            rejected_by=rejected_by,
        )
        return SimpleNamespace(id=order_id, status=SimpleNamespace(value="rejected")), False

    monkeypatch.setattr(decisions.co_svc, "reject_with_effects", fake_reject_with_effects)

    result = await decisions.portal_reject_change_order(
        "project-1",
        "change-order-1",
        decisions.PortalChangeOrderDecisionIn(token="accept-token"),
        _CustomerDb(),
    )

    assert result == {"id": "change-order-1", "status": "rejected"}
    assert captured == {
        "project_id": "project-1",
        "order_id": "change-order-1",
        "rejected_by": "customer-1",
    }


@pytest.mark.parametrize(
    "endpoint",
    [decisions.portal_approve_change_order, decisions.portal_reject_change_order],
)
def test_change_order_endpoint_uses_canonical_scope_guard(endpoint):
    source = inspect.getsource(endpoint)

    assert "claims = _portal_claims(body.token, project_id)" in source
    assert '_require_portal_scope(claims, "accept_stage")' in source
    assert "portal_tok.verify_portal_token" not in source
    assert source.index("_require_portal_scope") < source.index("_require_customer")


def test_runtime_registers_one_canonical_route_per_decision():
    for path in (
        "/api/v1/portal/projects/{project_id}/change-orders/{order_id}/approve",
        "/api/v1/portal/projects/{project_id}/change-orders/{order_id}/reject",
    ):
        matches = [route for route in api_router.routes if getattr(route, "path", None) == path]
        assert len(matches) == 1
        assert matches[0].endpoint.__module__ == decisions.__name__
