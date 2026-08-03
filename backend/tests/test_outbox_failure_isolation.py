import logging
from datetime import timedelta

import pytest

from app.core.timeutil import utc_now
from app.models.entities import DomainOutbox
from app.services import outbox_service


@pytest.mark.asyncio
async def test_failed_event_does_not_expire_logging_context_or_stop_next_event(
    db,
    monkeypatch,
    caplog,
):
    first = await outbox_service.enqueue(
        db,
        aggregate_type="failure_isolation",
        aggregate_id="fail",
        event_type="test.failure_isolation",
        payload={"sequence": 1},
    )
    second = await outbox_service.enqueue(
        db,
        aggregate_type="failure_isolation",
        aggregate_id="succeed",
        event_type="test.failure_isolation",
        payload={"sequence": 2},
    )
    first_id = first.id
    second_id = second.id
    now = utc_now()
    first.created_at = now - timedelta(seconds=1)
    second.created_at = now
    await db.commit()

    handled: list[str] = []

    async def synthetic_handler(_db, row):
        handled.append(row.aggregate_id)
        if row.aggregate_id == "fail":
            raise RuntimeError("synthetic_delivery_failure")

    monkeypatch.setattr(outbox_service, "_handle", synthetic_handler)
    caplog.set_level(logging.ERROR, logger="renova.outbox")

    processed = await outbox_service.dispatch_pending(
        db,
        limit=2,
        worker_id="failure-isolation-test",
    )

    assert processed == 1
    assert handled == ["fail", "succeed"]
    assert "synthetic_delivery_failure" in caplog.text
    assert "MissingGreenlet" not in caplog.text

    failed = await db.get(DomainOutbox, first_id)
    succeeded = await db.get(DomainOutbox, second_id)
    assert failed is not None
    assert failed.processed_at is None
    assert failed.attempts == 1
    assert failed.last_error == "synthetic_delivery_failure"
    assert succeeded is not None
    assert succeeded.processed_at is not None
    assert succeeded.attempts == 1
    assert succeeded.last_error is None
