from __future__ import annotations

import inspect

from app.models import material_price_truth
from app.models.entities import MaterialPick
from app.services import purchase_service, selection_service


def _pick(*, price: float, source: str) -> MaterialPick:
    return MaterialPick(
        project_id="price-writer-project",
        name="Материал",
        qty=1,
        unit="шт",
        price=price,
        price_source=source,
    )


def test_estimate_price_is_not_actionable_until_explicit_confirmation():
    pick = _pick(price=1500, source="estimate")
    assert material_price_truth.is_actionable_purchase_price(pick) is False


def test_approved_selection_price_is_actionable_but_not_live_verified():
    pick = _pick(price=1500, source="selection_approved")
    assert material_price_truth.is_actionable_purchase_price(pick) is True
    assert material_price_truth.is_verified_price_source(pick.price_source) is False


def test_internal_material_writers_declare_provenance_explicitly():
    estimate_source = inspect.getsource(purchase_service.generate_needs_from_estimate)
    selection_source = inspect.getsource(selection_service.material_pick_from_selection)
    assert 'price_source="estimate"' in estimate_source
    assert 'price_source="selection_approved"' in selection_source


def test_legacy_purchase_writer_uses_same_price_truth_gate():
    source = inspect.getsource(purchase_service.create_from_picks)
    assert "is_actionable_purchase_price" in source
    assert "purchase_pick_price_unverified" in source
