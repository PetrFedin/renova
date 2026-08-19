"""Register all ORM model modules in one deterministic package import."""
from __future__ import annotations

# entities remains the compatibility surface for the decomposed model package.
from app.models import entities as entities
# Profile fields are registered after the legacy entities module is mapped.
from app.models import project_profile as project_profile
# Runtime ledgers must also be visible to Alembic metadata and local create_all.
from app.models import outbox_runtime as outbox_runtime
from app.models.calendar import CalendarItem as CalendarItem
from app.models.subscription_checkout import SubscriptionCheckout as SubscriptionCheckout
from app.models.subscription_checkout import SubscriptionRefund as SubscriptionRefund
from app.models.subscription_checkout import (
    SubscriptionRefundReviewEvent as SubscriptionRefundReviewEvent,
)

__all__ = [
    "entities",
    "project_profile",
    "outbox_runtime",
    "CalendarItem",
    "SubscriptionCheckout",
    "SubscriptionRefund",
    "SubscriptionRefundReviewEvent",
]
