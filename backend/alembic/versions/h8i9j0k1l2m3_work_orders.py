"""work_orders — детальные работы по комнатам и датам

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
"""
from alembic import op
import sqlalchemy as sa

revision = "h8i9j0k1l2m3"
down_revision = "g7h8i9j0k1l2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=True, index=True),
        sa.Column("stage_id", sa.String(36), sa.ForeignKey("stages.id"), nullable=True, index=True),
        sa.Column("work_type", sa.String(64), nullable=False, index=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft", "published", "negotiating", "approved", "in_progress",
                "review", "done", "paid", "cancelled",
                name="workorderstatus",
            ),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("planned_start", sa.Date(), nullable=True),
        sa.Column("planned_end", sa.Date(), nullable=True),
        sa.Column("actual_start", sa.Date(), nullable=True),
        sa.Column("actual_end", sa.Date(), nullable=True),
        sa.Column("assignee_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("chat_thread_id", sa.String(36), sa.ForeignKey("chat_threads.id"), nullable=True),
        sa.Column("budget_planned", sa.Float(), server_default="0"),
        sa.Column("budget_spent", sa.Float(), server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("work_orders")
    op.execute("DROP TYPE IF EXISTS workorderstatus")
