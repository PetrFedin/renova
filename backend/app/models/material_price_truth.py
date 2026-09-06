"""Durable price provenance for the canonical MaterialPick model.

The numeric price alone is not sufficient financial evidence. These mapped
attributes keep the latest known provenance on the existing material master so
later reads can distinguish explicit user-entered values, estimate/selection
derivations, legacy-unknown data and externally verified supplier prices
without creating a parallel entity.
"""
from __future__ import annotations

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import add_mapped_attribute, mapped_column

from app.models.entities import MaterialPick, MaterialPickStatus


PRICE_SOURCE_VALUES = (
    "unset",
    "legacy_unknown",
    "manual",
    "estimate",
    "selection_approved",
    "live_jsonld",
    "live_meta",
    "live_currency",
)
LIVE_PRICE_SOURCE_VALUES = frozenset(
    {"live_jsonld", "live_meta", "live_currency"}
)
ACTIONABLE_PRICE_SOURCE_VALUES = frozenset(
    {"manual", "selection_approved", *LIVE_PRICE_SOURCE_VALUES}
)


def _default_price_source(context) -> str:
    # Compatibility default for direct ORM construction. Production services
    # that derive a price from another domain object must set their provenance
    # explicitly (`estimate`, `selection_approved`, etc.).
    params = context.get_current_parameters() if context is not None else {}
    return "manual" if float(params.get("price") or 0) > 0 else "unset"


def is_verified_price_source(source: str | None) -> bool:
    return source in LIVE_PRICE_SOURCE_VALUES


def is_actionable_purchase_price(pick: MaterialPick) -> bool:
    """Return whether current material price may become a Purchase unit price.

    Explicit manual, approved-selection and live-verified sources are directly
    actionable when positive. Estimate-derived prices are only actionable once
    the customer has explicitly approved the MaterialPick that displays that
    price. Historical unknown values never become actionable merely because the
    row already happens to be approved.
    """
    if float(pick.price or 0) <= 0:
        return False
    if pick.price_source in ACTIONABLE_PRICE_SOURCE_VALUES:
        return True
    return pick.price_source == "estimate" and pick.status == MaterialPickStatus.approved


add_mapped_attribute(
    MaterialPick,
    "price_source",
    mapped_column(String(32), nullable=False, default=_default_price_source),
)
add_mapped_attribute(
    MaterialPick,
    "price_verified_at",
    mapped_column(DateTime, nullable=True),
)
add_mapped_attribute(
    MaterialPick,
    "price_source_url",
    mapped_column(String(512), nullable=True),
)
MaterialPick.__table__.append_constraint(
    CheckConstraint(
        "price_source IN ('unset','legacy_unknown','manual','estimate','selection_approved','live_jsonld','live_meta','live_currency')",
        name="ck_material_picks_price_source",
    )
)
