"""Smoke: chat_acl helpers importable (full ACL e2e needs DB fixtures)."""
from app.services.chat_acl import require_chat_access, require_chat_message


def test_helpers_exported():
    assert callable(require_chat_access)
    assert callable(require_chat_message)
