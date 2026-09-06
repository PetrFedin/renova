"""add durable material price provenance

Revision ID: w21materialprice01
Revises: w20materialsupply01
Create Date: 2026-09-06
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w21materialprice01"
down_revision: str | None = "w20materialsupply01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_PRICE_SOURCE_CHECK = (
    "price_source IN ('unset','legacy_unknown','manual','live_jsonld','live_meta','live_currency')"
)


def upgrade() -> None:
    # Start fail-closed. Existing rows have no durable evidence telling us how
    # their numeric price was obtained. We can safely infer zero as unset and
    # non-zero historical values as explicit/manual except the exact legacy
    # production stub shape: 1000 with no supplier URL. That shape remains
    # quarantined as legacy_unknown and cannot enter a new Purchase until it is
    # replaced by explicit or live-verified truth.
    op.add_column(
        "material_picks",
        sa.Column(
            "price_source",
            sa.String(length=32),
            nullable=False,
            server_default="legacy_unknown",
        ),
    )
    op.add_column(
        "material_picks",
        sa.Column("price_verified_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "material_picks",
        sa.Column("price_source_url", sa.String(length=512), nullable=True),
    )
    op.execute("UPDATE material_picks SET price_source = 'unset' WHERE COALESCE(price, 0) <= 0")
    op.execute(
        "UPDATE material_picks SET price_source = 'manual' "
        "WHERE COALESCE(price, 0) > 0 "
        "AND NOT (price = 1000.0 AND NULLIF(TRIM(shop_url), '') IS NULL)"
    )
    op.create_check_constraint(
        "ck_material_picks_price_source",
        "material_picks",
        _PRICE_SOURCE_CHECK,
    )
    op.alter_column("material_picks", "price_source", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "ck_material_picks_price_source",
        "material_picks",
        type_="check",
    )
    op.drop_column("material_picks", "price_source_url")
    op.drop_column("material_picks", "price_verified_at")
    op.drop_column("material_picks", "price_source")
