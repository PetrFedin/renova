"""Canonical supply truth extensions for the legacy MaterialPick model.

`app.models` imports extension modules after `entities`, so declarative mapped
attributes added here participate in the same MaterialPick table and Alembic
metadata without introducing a second material entity.
"""
from __future__ import annotations

from sqlalchemy import CheckConstraint, Float, String
from sqlalchemy.orm import mapped_column

from app.models.entities import MaterialPick


SUPPLY_SOURCE_VALUES = (
    "customer_on_hand",
    "customer_to_buy",
    "contractor_to_buy",
    "contractor_included",
    "third_party",
)
DEFAULT_SUPPLY_SOURCE = "contractor_to_buy"


# SQLAlchemy Declarative explicitly supports appending mapped columns to an
# already-declared class. Keep the legacy compatibility surface untouched while
# the extension remains one physical `material_picks` table.
MaterialPick.supply_source = mapped_column(  # type: ignore[attr-defined]
    String(32),
    nullable=False,
    default=DEFAULT_SUPPLY_SOURCE,
)
MaterialPick.qty_available = mapped_column(  # type: ignore[attr-defined]
    Float,
    nullable=False,
    default=0,
)
MaterialPick.__table__.append_constraint(
    CheckConstraint(
        "supply_source IN ('customer_on_hand','customer_to_buy','contractor_to_buy','contractor_included','third_party')",
        name="ck_material_picks_supply_source",
    )
)
MaterialPick.__table__.append_constraint(
    CheckConstraint("qty_available >= 0", name="ck_material_picks_qty_available_nonnegative")
)
