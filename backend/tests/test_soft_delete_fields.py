"""P2.21 soft-delete fields exist on User model."""
from app.models.entities import User


def test_user_has_soft_delete_columns():
    assert hasattr(User, "deleted_at")
    assert hasattr(User, "deletion_requested_at")
