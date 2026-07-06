"""chat enhancements — unread, archive, pin, reactions, participants

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
"""
from alembic import op
import sqlalchemy as sa

revision = "i9j0k1l2m3n4"
down_revision = "h8i9j0k1l2m3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_thread_reads", sa.Column("is_archived", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("chat_thread_reads", sa.Column("is_pinned", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("chat_thread_reads", sa.Column("pinned_at", sa.DateTime(), nullable=True))
    op.add_column("chat_messages", sa.Column("is_pinned", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("chat_messages", sa.Column("reply_to_id", sa.String(36), sa.ForeignKey("chat_messages.id"), nullable=True))
    op.add_column("chat_messages", sa.Column("meta_json", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("profile_code", sa.String(8), nullable=True))
    op.create_index("ix_users_profile_code", "users", ["profile_code"], unique=True)
    op.create_table(
        "chat_thread_participants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), sa.ForeignKey("chat_threads.id"), nullable=False, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("profile_code", sa.String(8), nullable=True),
        sa.Column("invited_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(16), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("chat_thread_participants")
    op.drop_index("ix_users_profile_code", "users")
    op.drop_column("users", "profile_code")
    op.drop_column("chat_messages", "meta_json")
    op.drop_column("chat_messages", "reply_to_id")
    op.drop_column("chat_messages", "is_pinned")
    op.drop_column("chat_thread_reads", "pinned_at")
    op.drop_column("chat_thread_reads", "is_pinned")
    op.drop_column("chat_thread_reads", "is_archived")
