"""contractor payment_requisites for honest SBP transfer

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-07-19

Таблица contractor_profiles могла жить только через create_all/sqlite —
в чистом PG CI её нет. Миграция идемпотентна: create table + add column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "v6w7x8y9z0a1"
down_revision: Union[str, None] = "u5v6w7x8y9z0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    tables = insp.get_table_names()
    if "contractor_profiles" not in tables:
        op.create_table(
            "contractor_profiles",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("company_name", sa.String(length=255), nullable=True),
            sa.Column("specialties", sa.String(length=512), nullable=True),
            sa.Column("rating", sa.Float(), nullable=False, server_default="5"),
            sa.Column("jobs_done", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("city", sa.String(length=64), nullable=True),
            sa.Column("bio", sa.Text(), nullable=True),
            sa.Column("payment_requisites", sa.Text(), nullable=True),
            sa.Column("visible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.UniqueConstraint("user_id"),
        )
        op.create_index("ix_contractor_profiles_user_id", "contractor_profiles", ["user_id"])
        return

    cols = {c["name"] for c in insp.get_columns("contractor_profiles")}
    if "payment_requisites" not in cols:
        op.add_column("contractor_profiles", sa.Column("payment_requisites", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "contractor_profiles" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("contractor_profiles")}
    if "payment_requisites" in cols:
        op.drop_column("contractor_profiles", "payment_requisites")
