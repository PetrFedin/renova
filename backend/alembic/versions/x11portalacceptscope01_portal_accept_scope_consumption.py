"""Atomically single-use portal acceptance decision scope (#676).

Revision ID: x11portalacceptscope01
Revises: x10executionproof01
"""
from alembic import op
import sqlalchemy as sa

revision = "x11portalacceptscope01"
down_revision = "x10executionproof01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("portal_links", sa.Column("accept_stage_consumed_at", sa.DateTime(), nullable=True))
    op.add_column("portal_links", sa.Column("accept_stage_acceptance_id", sa.String(length=36), nullable=True))
    op.add_column("portal_links", sa.Column("accept_stage_decision", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("portal_links", "accept_stage_decision")
    op.drop_column("portal_links", "accept_stage_acceptance_id")
    op.drop_column("portal_links", "accept_stage_consumed_at")
