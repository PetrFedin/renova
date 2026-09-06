"""Durable price provenance for the canonical MaterialPick model.

The numeric price alone is not sufficient financial evidence. These mapped
attributes keep the latest known provenance on the existing material master so
later reads can distinguish explicit user-entered values, legacy-unknown data
and externally verified supplier prices without creating a parallel entity.
"""
from __future__ import annotations

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import add_mapped_attribute, mapped_column

from app.models.entities import MaterialPick


PRICE_SOURCE_VALUES = (
    "unset",
    "legacy_unknown",
    "manual",
    "live_jsonld",
    "live_meta",
    "live_currency",
)
LIVE_PRICE_SOURCE_VALUES = frozenset(
    {"live_jsonld", "live_meta", "live_currency"}
)


def _default_price_source(context) -> str:
    params = context.get_current_parameters() if context is not None else {}
    return "manual" if float(params.get("price") or 0) > 0 else "unset"


def is_verified_price_source(source: str | None) -> bool:
    return source in LIVE_PRICE_SOURCE_VALUES


def is_actionable_purchase_price(pick: MaterialPick) -> bool:
    """A purchase may use only an explicit or externally verified positive price."""
    return float(pick.price or 0) > 0 and pick.price_source in {
        "manual",
        *LIVE_PRICE_SOURCE_VALUES,
    }


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
        "price_source IN ('unset','legacy_unknown','manual','live_jsonld','live_meta','live_currency')",
        name="ck_material_picks_price_source",
    )
)
