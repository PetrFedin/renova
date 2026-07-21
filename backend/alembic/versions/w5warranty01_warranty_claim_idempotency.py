"""warranty_claim_idempotency unique scope

Revision ID: w5warranty01
Revises: w4jtipurge01
Create Date: 2026-07-21

Таблица идемпотентности POST /projects/{id}/warranty-claims.
Scope: (user_id, project_id, idempotency_key).
Rollback: DROP TABLE warranty_claim_idempotency — существующие issues/docs не затрагиваются.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "w5warranty01"
down_revision: Union[str, Sequence[str], None] = "w4jtipurge01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "warranty_claim_idempotency" in insp.get_table_names():
        return
    op.create_table(
        "warranty_claim_idempotency",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("issue_id", sa.String(36), nullable=False, index=True),
        sa.Column("document_id", sa.String(36), nullable=False, index=True),
        sa.Column("response_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "user_id",
            "project_id",
            "idempotency_key",
            name="uq_warranty_claim_idempotency_scope",
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "warranty_claim_idempotency" in insp.get_table_names():
        op.drop_table("warranty_claim_idempotency")
