"""Purge service importable."""
from app.services.account_purge_service import RETENTION_DAYS, purge_deleted_users


def test_retention_days():
    assert RETENTION_DAYS == 30
    assert callable(purge_deleted_users)
