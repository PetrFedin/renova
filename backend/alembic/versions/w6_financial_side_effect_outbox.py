"""durable financial side-effect outbox runtime

Revision ID: w6sidefxoutbox1
Revises: w5clientidemp01
"""

from alembic import op
import sqlalchemy as sa


revision = "w6sidefxoutbox1"
down_revision = "w5clientidemp01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "domain_outbox_leases",
        sa.Column("outbox_id", sa.String(length=36), nullable=False),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("locked_by", sa.String(length=64), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["outbox_id"], ["domain_outbox.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("outbox_id"),
    )
    op.create_index("ix_domain_outbox_leases_locked_at", "domain_outbox_leases", ["locked_at"])
    op.create_index("ix_domain_outbox_leases_next_attempt_at", "domain_outbox_leases", ["next_attempt_at"])

    op.create_table(
        "side_effect_deliveries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("outbox_id", sa.String(length=36), nullable=False),
        sa.Column("effect_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=36), nullable=False),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["outbox_id"], ["domain_outbox.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_id", name="uq_side_effect_delivery_outbox"),
    )
    op.create_index("ix_side_effect_deliveries_outbox_id", "side_effect_deliveries", ["outbox_id"])
    op.create_index("ix_side_effect_deliveries_effect_type", "side_effect_deliveries", ["effect_type"])
    op.create_index("ix_side_effect_deliveries_entity_id", "side_effect_deliveries", ["entity_id"])

    op.execute(
        sa.text(
            """
            INSERT INTO domain_outbox_leases
                (outbox_id, locked_at, locked_by, next_attempt_at, created_at, updated_at)
            SELECT id, NULL, NULL, NULL, created_at, created_at
            FROM domain_outbox
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_side_effect_deliveries_entity_id", table_name="side_effect_deliveries")
    op.drop_index("ix_side_effect_deliveries_effect_type", table_name="side_effect_deliveries")
    op.drop_index("ix_side_effect_deliveries_outbox_id", table_name="side_effect_deliveries")
    op.drop_table("side_effect_deliveries")
    op.drop_index("ix_domain_outbox_leases_next_attempt_at", table_name="domain_outbox_leases")
    op.drop_index("ix_domain_outbox_leases_locked_at", table_name="domain_outbox_leases")
    op.drop_table("domain_outbox_leases")
