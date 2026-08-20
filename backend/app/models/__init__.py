"""Register every ORM model module in one deterministic package import.

Alembic imports :mod:`app.models` to populate ``Base.metadata``.  Keeping a
hand-maintained subset here allowed model-only tables to disappear from
Alembic autogenerate while SQLite ``create_all`` tests still passed.  Load the
legacy entities module first, then every other Python module in this package
in sorted order so new model modules cannot be silently omitted from metadata.
"""
from __future__ import annotations

from importlib import import_module
from pkgutil import iter_modules

# The legacy entities module remains the compatibility surface and must be
# mapped before extension modules that reference its tables/classes.
from app.models import entities as entities


def _register_all_model_modules() -> tuple[str, ...]:
    package_path = list(__path__)
    module_names = sorted(
        module.name
        for module in iter_modules(package_path)
        if not module.ispkg and module.name not in {"__init__", "entities"}
    )
    for module_name in module_names:
        import_module(f"{__name__}.{module_name}")
    return tuple(module_names)


REGISTERED_MODEL_MODULES = _register_all_model_modules()

# Preserve the named compatibility exports used by existing imports.
from app.models.calendar import CalendarItem as CalendarItem  # noqa: E402
from app.models.subscription_checkout import SubscriptionCheckout as SubscriptionCheckout  # noqa: E402
from app.models.subscription_checkout import SubscriptionRefund as SubscriptionRefund  # noqa: E402
from app.models.subscription_checkout import (  # noqa: E402
    SubscriptionRefundReviewEvent as SubscriptionRefundReviewEvent,
)

__all__ = [
    "entities",
    "REGISTERED_MODEL_MODULES",
    "CalendarItem",
    "SubscriptionCheckout",
    "SubscriptionRefund",
    "SubscriptionRefundReviewEvent",
]
