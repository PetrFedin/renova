"""Canonical calculations for material supply, availability and procurement."""
from __future__ import annotations

from dataclasses import dataclass

from app.models.entities import MaterialPick, MaterialPickStatus, Project, User
from app.models.material_supply import DEFAULT_SUPPLY_SOURCE, SUPPLY_SOURCE_VALUES

BUY_REQUIRED_SOURCES = frozenset({"customer_to_buy", "contractor_to_buy"})
NON_PURCHASE_SOURCES = frozenset({"customer_on_hand", "contractor_included", "third_party"})
SUPPLY_SOURCE_LABELS = {
    "customer_on_hand": "У заказчика",
    "customer_to_buy": "Покупает заказчик",
    "contractor_to_buy": "Покупает исполнитель",
    "contractor_included": "Включено в работы",
    "third_party": "Поставляет третья сторона",
}
EPSILON = 1e-9


class MaterialSupplyError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class MaterialSupplySnapshot:
    required_qty: float
    qty_available: float
    qty_delivered: float
    total_available: float
    qty_to_buy: float
    is_available: bool
    buy_required: bool


def source_label(source: str) -> str:
    return SUPPLY_SOURCE_LABELS.get(source, source)


def supply_source(pick: MaterialPick) -> str:
    value = getattr(pick, "supply_source", None) or DEFAULT_SUPPLY_SOURCE
    return str(value)


def required_quantity(pick: MaterialPick) -> float:
    raw = pick.qty_needed if pick.qty_needed is not None else pick.qty
    return max(float(raw or 0), 0.0)


def available_quantity(pick: MaterialPick) -> float:
    return max(float(getattr(pick, "qty_available", 0) or 0), 0.0)


def delivered_quantity(pick: MaterialPick) -> float:
    delivered = max(float(pick.qty_delivered or 0), 0.0)
    # Backward-compatible truth for legacy rows that were marked purchased
    # before delivered quantity became authoritative.
    if pick.status == MaterialPickStatus.purchased and delivered <= EPSILON:
        return required_quantity(pick)
    return delivered


def snapshot(pick: MaterialPick) -> MaterialSupplySnapshot:
    required = required_quantity(pick)
    available = available_quantity(pick)
    delivered = delivered_quantity(pick)
    total = available + delivered
    source = supply_source(pick)
    buy_required = source in BUY_REQUIRED_SOURCES
    to_buy = max(required - total, 0.0) if buy_required else 0.0
    return MaterialSupplySnapshot(
        required_qty=required,
        qty_available=available,
        qty_delivered=delivered,
        total_available=total,
        qty_to_buy=to_buy,
        is_available=total + EPSILON >= required,
        buy_required=buy_required,
    )


def validate_supply_truth(
    *,
    source: str,
    required_qty: float,
    qty_available: float | None,
) -> float:
    if source not in SUPPLY_SOURCE_VALUES:
        raise MaterialSupplyError("material_supply_source_invalid", "Неизвестный источник материала")
    required = max(float(required_qty or 0), 0.0)
    available = float(qty_available or 0)
    if available < -EPSILON:
        raise MaterialSupplyError(
            "material_qty_available_invalid",
            "Доступное количество не может быть отрицательным",
        )
    if available > required + EPSILON:
        raise MaterialSupplyError(
            "material_qty_available_exceeds_required",
            "Доступное количество не может превышать требуемое",
        )
    if source == "customer_on_hand" and available + EPSILON < required:
        raise MaterialSupplyError(
            "customer_on_hand_quantity_incomplete",
            "Для материала «у заказчика» укажите всё требуемое количество как доступное",
        )
    return max(available, 0.0)


def default_source_for_project(project: Project, actor: User | None = None) -> str:
    if actor is not None and actor.id == project.customer_id:
        return "customer_to_buy"
    if actor is not None and project.contractor_id and actor.id == project.contractor_id:
        return "contractor_to_buy"
    return "contractor_to_buy" if project.contractor_id else "customer_to_buy"


def actor_can_purchase(*, project: Project, actor: User, pick: MaterialPick) -> bool:
    source = supply_source(pick)
    if source == "customer_to_buy":
        return actor.id == project.customer_id
    if source == "contractor_to_buy":
        return bool(project.contractor_id and actor.id == project.contractor_id)
    return False
