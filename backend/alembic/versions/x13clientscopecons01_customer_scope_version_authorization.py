"""Customer scope versions, exact customer decisions and reserved finance authority.

Revision ID: x13clientscopecons01
Revises: x12projectrefund01
"""
from alembic import op
import sqlalchemy as sa

revision = "x13clientscopecons01"
down_revision = "x12projectrefund01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_scope_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("work_order_id", sa.String(36), sa.ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client_request_id", sa.String(80), nullable=False),
        sa.Column("work_order_updated_at", sa.DateTime(), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("snapshot_sha256", sa.String(64), nullable=False),
        sa.Column("specialist_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
        sa.Column("unit", sa.String(24), nullable=False),
        sa.Column("unit_price", sa.Numeric(14, 2), nullable=False),
        sa.Column("amount_cap", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("work_order_id", "version", name="uq_client_scope_work_order_version"),
        sa.UniqueConstraint("project_id", "created_by", "client_request_id", name="uq_client_scope_client_request"),
        sa.CheckConstraint("version > 0", name="ck_client_scope_version_positive"),
        sa.CheckConstraint("amount_cap > 0", name="ck_client_scope_amount_positive"),
        sa.CheckConstraint("quantity > 0", name="ck_client_scope_quantity_positive"),
        sa.CheckConstraint("unit_price > 0", name="ck_client_scope_unit_price_positive"),
        sa.CheckConstraint("currency = 'RUB'", name="ck_client_scope_rub_only"),
    )
    op.create_index("ix_client_scope_versions_project_id", "client_scope_versions", ["project_id"])
    op.create_index("ix_client_scope_versions_work_order_id", "client_scope_versions", ["work_order_id"])

    op.create_table(
        "client_scope_decisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_version_id", sa.String(36), sa.ForeignKey("client_scope_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("customer_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reviewed_digest", sa.String(64), nullable=False),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("scope_version_id", name="uq_client_scope_one_decision"),
        sa.CheckConstraint("decision IN ('approved', 'rejected')", name="ck_client_scope_decision"),
    )
    op.create_index("ix_client_scope_decisions_project_id", "client_scope_decisions", ["project_id"])

    op.create_table(
        "client_financial_authorizations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_version_id", sa.String(36), sa.ForeignKey("client_scope_versions.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("decision_id", sa.String(36), sa.ForeignKey("client_scope_decisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("customer_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount_cap", sa.Numeric(14, 2), nullable=False),
        sa.Column("committed_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("consumed_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("decision_id", name="uq_client_financial_decision"),
        sa.CheckConstraint("amount_cap > 0", name="ck_client_financial_cap_positive"),
        sa.CheckConstraint(
            "committed_amount >= 0 AND committed_amount <= amount_cap",
            name="ck_client_financial_committed_within_cap",
        ),
        sa.CheckConstraint(
            "consumed_amount >= 0 AND consumed_amount <= committed_amount",
            name="ck_client_financial_consumed_within_commitment",
        ),
        sa.CheckConstraint("currency = 'RUB'", name="ck_client_financial_rub_only"),
    )
    op.create_index("ix_client_financial_authorizations_project_id", "client_financial_authorizations", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_client_financial_authorizations_project_id", table_name="client_financial_authorizations")
    op.drop_table("client_financial_authorizations")
    op.drop_index("ix_client_scope_decisions_project_id", table_name="client_scope_decisions")
    op.drop_table("client_scope_decisions")
    op.drop_index("ix_client_scope_versions_work_order_id", table_name="client_scope_versions")
    op.drop_index("ix_client_scope_versions_project_id", table_name="client_scope_versions")
    op.drop_table("client_scope_versions")
