from __future__ import annotations

import importlib

from app.core.security import create_access_token
from app.services import ws_ticket_service


def test_ws_ticket_round_trip_survives_module_reload() -> None:
    ticket, ttl = ws_ticket_service.issue_ws_ticket("user-123")

    assert ttl == 120
    # Reload clears all module-local state. A valid ticket must still work so
    # HTTP minting and WebSocket upgrade can land on different workers.
    reloaded = importlib.reload(ws_ticket_service)
    assert reloaded.consume_ws_ticket(ticket) == "user-123"


def test_ws_ticket_rejects_expired_ticket() -> None:
    ticket, _ = ws_ticket_service.issue_ws_ticket("user-123", ttl=-1)

    assert ws_ticket_service.consume_ws_ticket(ticket) is None


def test_ws_ticket_rejects_tampered_ticket() -> None:
    ticket, _ = ws_ticket_service.issue_ws_ticket("user-123")
    head, payload, signature = ticket.split(".")
    tampered_payload = ("A" if payload[0] != "A" else "B") + payload[1:]
    tampered = ".".join((head, tampered_payload, signature))

    assert ws_ticket_service.consume_ws_ticket(tampered) is None


def test_access_token_cannot_be_used_as_ws_ticket() -> None:
    access_token = create_access_token("user-123")

    assert ws_ticket_service.consume_ws_ticket(access_token) is None


def test_ws_ticket_rejects_empty_or_malformed_subject() -> None:
    assert ws_ticket_service.consume_ws_ticket("") is None
    assert ws_ticket_service.consume_ws_ticket("not-a-jwt") is None
