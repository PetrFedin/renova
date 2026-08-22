"""Administrative routes must not equate contractor with administrator."""
from __future__ import annotations

import inspect

import pytest
from fastapi import HTTPException
from fastapi.routing import iter_route_contexts

from app.api.admin_access import admin_access_state, require_admin_user
from app.api.v1 import admin, admin_outbox_dead_letters
from app.core.config import settings
from app.models.entities import User, UserRole
from app.services.staging_readiness import build_h0_readiness


def _user(user_id: str, role: UserRole = UserRole.contractor) -> User:
    return User(id=user_id, phone=f"+7999{abs(hash(user_id)) % 10000000:07d}", role=role)


def test_working_environment_is_fail_closed_without_admin_ids(monkeypatch):
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "admin_user_ids", "")

    allowed, reason = admin_access_state(_user("contractor-a"))

    assert allowed is False
    assert reason == "admin_access_not_configured"
    readiness = build_h0_readiness()
    admin_check = next(item for item in readiness["checks"] if item["id"] == "admin_identity")
    assert admin_check["ok"] is False
    assert any(item["id"] == "admin_identity" for item in readiness["blockers"])
    assert readiness["ready_for_investor_demo"] is False


def test_only_explicit_identity_is_admin_in_working_environment(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "admin_user_ids", "admin-a, admin-b")

    assert admin_access_state(_user("admin-a")) == (True, "explicit_admin_identity")
    assert admin_access_state(_user("contractor-a")) == (
        False,
        "admin_identity_forbidden",
    )
    assert admin_access_state(_user("admin-a", UserRole.customer)) == (
        False,
        "admin_role_forbidden",
    )


@pytest.mark.asyncio
async def test_dependency_returns_admin_and_rejects_other_actors(monkeypatch):
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "admin_user_ids", "admin-a")

    admin_user = _user("admin-a")
    assert await require_admin_user(admin_user) is admin_user

    with pytest.raises(HTTPException) as forbidden:
        await require_admin_user(_user("contractor-a"))
    assert forbidden.value.status_code == 403
    assert forbidden.value.detail["code"] == "admin_identity_forbidden"

    monkeypatch.setattr(settings, "admin_user_ids", "")
    with pytest.raises(HTTPException) as missing:
        await require_admin_user(admin_user)
    assert missing.value.status_code == 403
    assert missing.value.detail["code"] == "admin_access_not_configured"


def test_local_demo_fallback_does_not_apply_to_customers(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "admin_user_ids", "")

    assert admin_access_state(_user("local-contractor")) == (
        True,
        "local_contractor_fallback",
    )
    assert admin_access_state(_user("local-customer", UserRole.customer))[0] is False


def test_every_admin_route_uses_canonical_guard():
    source = inspect.getsource(admin)
    dead_letter_source = inspect.getsource(admin_outbox_dead_letters)

    assert "Depends(get_current_user)" not in source
    assert "UserRole.contractor" not in source
    assert source.count("Depends(require_admin_user)") == 5
    assert "Depends(get_current_user)" not in dead_letter_source
    assert "UserRole.contractor" not in dead_letter_source
    assert dead_letter_source.count("Depends(require_admin_user)") == 6

    get_paths = {
        route.path
        for route in iter_route_contexts(admin.router.routes)
        if "GET" in (route.methods or set())
    }
    assert get_paths == {
        "/admin/stats",
        "/admin/projects-chart",
        "/admin/revenue-chart",
        "/admin/release-health",
        "/admin/h0-readiness",
        "/admin/outbox/dead-letters",
        "/admin/outbox/dead-letters/{outbox_id}",
        "/admin/outbox/dead-letters/{outbox_id}/history",
        "/admin/provider-reconciliations",
        "/admin/provider-reconciliations/{reconciliation_id}",
    }
    post_paths = {
        route.path
        for route in iter_route_contexts(admin.router.routes)
        if "POST" in (route.methods or set())
    }
    assert post_paths == {
        "/admin/outbox/dead-letters/{outbox_id}/claim",
        "/admin/outbox/dead-letters/{outbox_id}/release",
        "/admin/outbox/dead-letters/{outbox_id}/replay",
        "/admin/provider-reconciliations/{reconciliation_id}/requeue",
    }
