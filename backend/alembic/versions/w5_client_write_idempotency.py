"""client write request idempotency ledger

Revision ID: w5clientidemp01
Revises: w4jtipurge01
"""

from alembic import op
import sqlalchemy as sa


revision = "w5clientidemp01"
down_revision = "w4jtipurge01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_write_requests",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("scope", sa.String(length=40), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("request_id", sa.String(length=80), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "scope",
            "project_id",
            "user_id",
            "request_id",
            name="uq_client_write_request",
        ),
    )
    op.create_index("ix_client_write_requests_scope", "client_write_requests", ["scope"])
    op.create_index("ix_client_write_requests_project_id", "client_write_requests", ["project_id"])
    op.create_index("ix_client_write_requests_user_id", "client_write_requests", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_client_write_requests_user_id", table_name="client_write_requests")
    op.drop_index("ix_client_write_requests_project_id", table_name="client_write_requests")
    op.drop_index("ix_client_write_requests_scope", table_name="client_write_requests")
    op.drop_table("client_write_requests")
