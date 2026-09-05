"""Canonical supply truth extensions for the legacy MaterialPick model.

`app.models` imports extension modules after `entities`, so declarative mapped
attributes added here participate in the same MaterialPick table and Alembic
metadata without introducing a second material entity.
"""
from __future__ import annotations

from sqlalchemy import CheckConstraint, Float, String
from sqlalchemy.orm import add_mapped_attribute, mapped_column

from app.models.entities import MaterialPick


SUPPLY_SOURCE_VALUES = (
    "customer_on_hand",
    "customer_to_buy",
    "contractor_to_buy",
    "contractor_included",
    "third_party",
)
DEFAULT_SUPPLY_SOURCE = "contractor_to_buy"


# SQLAlchemy 2 supports adding mapped attributes after a declarative class is
# created. Use the explicit public helper rather than relying on DeclarativeMeta
# assignment magic so mapper + Alembic metadata stay in lockstep.
add_mapped_attribute(
    MaterialPick,
    "supply_source",
    mapped_column(String(32), nullable=False, default=DEFAULT_SUPPLY_SOURCE),
)
add_mapped_attribute(
    MaterialPick,
    "qty_available",
    mapped_column(Float, nullable=False, default=0),
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
