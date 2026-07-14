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


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _cols(name: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(name)}


def upgrade() -> None:
    # chat_thread_reads historically from create_all (SQLite)
    if not _has_table("chat_thread_reads"):
        op.create_table(
            "chat_thread_reads",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("thread_id", sa.String(36), sa.ForeignKey("chat_threads.id"), nullable=False, index=True),
            sa.Column("last_read_at", sa.DateTime(), nullable=True),
            sa.Column("is_archived", sa.Boolean(), server_default="0", nullable=False),
            sa.Column("is_pinned", sa.Boolean(), server_default="0", nullable=False),
            sa.Column("pinned_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("user_id", "thread_id", name="uq_chat_read"),
        )
    else:
        cols = _cols("chat_thread_reads")
        if "is_archived" not in cols:
            op.add_column("chat_thread_reads", sa.Column("is_archived", sa.Boolean(), server_default="0", nullable=False))
        if "is_pinned" not in cols:
            op.add_column("chat_thread_reads", sa.Column("is_pinned", sa.Boolean(), server_default="0", nullable=False))
        if "pinned_at" not in cols:
            op.add_column("chat_thread_reads", sa.Column("pinned_at", sa.DateTime(), nullable=True))

    msg_cols = _cols("chat_messages")
    if "is_pinned" not in msg_cols:
        op.add_column("chat_messages", sa.Column("is_pinned", sa.Boolean(), server_default="0", nullable=False))
    if "reply_to_id" not in msg_cols:
        op.add_column("chat_messages", sa.Column("reply_to_id", sa.String(36), sa.ForeignKey("chat_messages.id"), nullable=True))
    if "meta_json" not in msg_cols:
        op.add_column("chat_messages", sa.Column("meta_json", sa.Text(), nullable=True))

    user_cols = _cols("users")
    if "profile_code" not in user_cols:
        op.add_column("users", sa.Column("profile_code", sa.String(8), nullable=True))
        op.create_index("ix_users_profile_code", "users", ["profile_code"], unique=True)

    if not _has_table("chat_thread_participants"):
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
    if _has_table("chat_thread_participants"):
        op.drop_table("chat_thread_participants")
    # best-effort reverse; skip if columns absent
