"""add canonical material supply source and available quantity

Revision ID: w20materialsupply01
Revises: w19paymentevidence01
Create Date: 2026-09-05
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w20materialsupply01"
down_revision: str | None = "w19paymentevidence01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_SUPPLY_CHECK = (
    "supply_source IN ('customer_on_hand','customer_to_buy','contractor_to_buy',"
    "'contractor_included','third_party')"
)


def upgrade() -> None:
    # Existing rows model the historical flow: an approved pick was expected to
    # enter Renova procurement. Preserve that behavior, but do not assign a
    # nonexistent contractor to self-managed projects.
    op.add_column(
        "material_picks",
        sa.Column(
            "supply_source",
            sa.String(length=32),
            nullable=False,
            server_default="contractor_to_buy",
        ),
    )
    op.add_column(
        "material_picks",
        sa.Column("qty_available", sa.Float(), nullable=False, server_default="0"),
    )
    op.execute(
        "UPDATE material_picks AS mp SET supply_source = 'customer_to_buy' "
        "FROM projects AS p WHERE p.id = mp.project_id AND p.contractor_id IS NULL"
    )
    op.create_check_constraint(
        "ck_material_picks_supply_source",
        "material_picks",
        _SUPPLY_CHECK,
    )
    op.create_check_constraint(
        "ck_material_picks_qty_available_nonnegative",
        "material_picks",
        "qty_available >= 0",
    )

    # Runtime defaults are owned by the ORM, not persistent database defaults.
    op.alter_column("material_picks", "supply_source", server_default=None)
    op.alter_column("material_picks", "qty_available", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "ck_material_picks_qty_available_nonnegative",
        "material_picks",
        type_="check",
    )
    op.drop_constraint(
        "ck_material_picks_supply_source",
        "material_picks",
        type_="check",
    )
    op.drop_column("material_picks", "qty_available")
    op.drop_column("material_picks", "supply_source")
