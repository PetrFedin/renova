"""tokens_invalid_before + schedule_version

Revision ID: w4jtipurge01
Revises: w3outbox01
Create Date: 2026-07-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "w4jtipurge01"
down_revision: Union[str, Sequence[str], None] = "w3outbox01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    user_cols = {c["name"] for c in insp.get_columns("users")}
    if "tokens_invalid_before" not in user_cols:
        op.add_column("users", sa.Column("tokens_invalid_before", sa.DateTime(), nullable=True))

    tables = set(insp.get_table_names())
    if "project_work_schedules" in tables:
        pws = {c["name"] for c in insp.get_columns("project_work_schedules")}
        if "schedule_version" not in pws:
            op.add_column(
                "project_work_schedules",
                sa.Column("schedule_version", sa.Integer(), server_default="1", nullable=False),
            )
        if "supersedes_id" not in pws:
            op.add_column(
                "project_work_schedules",
                sa.Column("supersedes_id", sa.String(36), nullable=True),
            )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    tables = set(insp.get_table_names())
    if "project_work_schedules" in tables:
        pws = {c["name"] for c in insp.get_columns("project_work_schedules")}
        if "supersedes_id" in pws:
            op.drop_column("project_work_schedules", "supersedes_id")
        if "schedule_version" in pws:
            op.drop_column("project_work_schedules", "schedule_version")
    user_cols = {c["name"] for c in insp.get_columns("users")}
    if "tokens_invalid_before" in user_cols:
        op.drop_column("users", "tokens_invalid_before")
