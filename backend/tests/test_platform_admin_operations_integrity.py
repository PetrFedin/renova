"""Global platform operations must use the canonical administrator dependency."""
from __future__ import annotations

import inspect

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.api.deps import get_current_user
from app.api.v1 import (
    account_lifecycle,
    articles_admin,
    audit,
    automation_worker,
    ocr_worker,
)
from app.api.v1.articles_admin import ArticleIn
from app.core.config import settings
from app.main import app
from app.models.entities import User, UserRole


def _user(user_id: str, role: UserRole = UserRole.contractor) -> User:
    return User(
        id=user_id,
        phone=f"+7999{abs(hash(user_id)) % 10000000:07d}",
        role=role,
    )


def test_global_operation_modules_use_only_canonical_admin_guard():
    modules = (
        articles_admin,
        audit,
        automation_worker,
        ocr_worker,
    )
    expected_counts = {
        articles_admin: 4,
        audit: 1,
        automation_worker: 2,
        ocr_worker: 2,
    }
    for module in modules:
        source = inspect.getsource(module)
        assert "Depends(get_current_user)" not in source
        assert "UserRole.contractor" not in source
        assert source.count("Depends(require_admin_user)") == expected_counts[module]

    purge_source = inspect.getsource(account_lifecycle.purge_deleted_accounts)
    assert "Depends(require_admin_user)" in purge_source
    assert "authorize_account_purge(ops_secret)" in purge_source
    assert "UserRole.contractor" not in purge_source


def test_article_admin_input_rejects_ambiguous_slugs_and_invalid_read_time():
    valid = {
        "slug": "safe-repair-guide",
        "title": "Safe guide",
        "category": "repairs",
        "summary": "A useful summary",
        "body": "Full article body",
    }
    assert ArticleIn(**valid).read_min == 3

    with pytest.raises(ValidationError):
        ArticleIn(**{**valid, "slug": "Unsafe Slug"})
    with pytest.raises(ValidationError):
        ArticleIn(**{**valid, "read_min": 0})


@pytest.mark.asyncio
async def test_automation_worker_status_is_allowlist_only_in_staging(monkeypatch):
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "admin_user_ids", "platform-admin")
    transport = ASGITransport(app=app)

    current = _user("platform-admin")

    async def actor() -> User:
        return current

    app.dependency_overrides[get_current_user] = actor
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            allowed = await client.get("/api/v1/automation/worker")
            assert allowed.status_code == 200, allowed.text
            assert "healthy" in allowed.json()

            current = _user("ordinary-contractor")
            contractor = await client.get("/api/v1/automation/worker")
            assert contractor.status_code == 403, contractor.text
            assert contractor.json()["detail"]["code"] == "admin_identity_forbidden"
            assert "healthy" not in contractor.json()

            current = _user("ordinary-customer", UserRole.customer)
            customer = await client.get("/api/v1/automation/worker")
            assert customer.status_code == 403, customer.text
            assert customer.json()["detail"]["code"] == "admin_role_forbidden"
            assert "healthy" not in customer.json()
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_automation_tick_does_not_expose_internal_exception_text():
    source = inspect.getsource(automation_worker.automation_worker_tick)
    assert 'detail={"code": "automation_tick_failed"}' in source
    assert 'f"automation_tick_failed: {exc}"' not in source
