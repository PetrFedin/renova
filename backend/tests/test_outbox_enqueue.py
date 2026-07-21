"""P1.16 outbox model + enqueue shape."""
from app.models.entities import DomainOutbox
from app.services.outbox_service import enqueue
import asyncio


def test_domain_outbox_model():
    assert hasattr(DomainOutbox, "event_type")
    assert hasattr(DomainOutbox, "processed_at")
