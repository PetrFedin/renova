"""tokens_invalid_before + schedule_version

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("tokens_invalid_before", sa.DateTime(), nullable=True))
    op.add_column(
        "project_work_schedules",
        sa.Column("schedule_version", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "project_work_schedules",
        sa.Column("supersedes_id", sa.String(36), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_work_schedules", "supersedes_id")
    op.drop_column("project_work_schedules", "schedule_version")
    op.drop_column("users", "tokens_invalid_before")
