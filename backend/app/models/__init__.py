"""Register all ORM model modules in one deterministic package import."""
from __future__ import annotations

# entities remains the compatibility surface for the decomposed model package.
from app.models import entities as entities
# Profile fields are registered after the legacy entities module is mapped.
from app.models import project_profile as project_profile
from app.models.calendar import CalendarItem as CalendarItem
from app.models.subscription_checkout import SubscriptionCheckout as SubscriptionCheckout
from app.models.subscription_checkout import SubscriptionRefund as SubscriptionRefund
from app.models.subscription_checkout import (
    SubscriptionRefundReviewEvent as SubscriptionRefundReviewEvent,
)

__all__ = [
    "entities",
    "project_profile",
    "CalendarItem",
    "SubscriptionCheckout",
    "SubscriptionRefund",
    "SubscriptionRefundReviewEvent",
]
